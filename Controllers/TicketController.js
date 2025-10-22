const { getPool, sql } = require('../config/database');
const Joi = require('joi');

// Validation schema
const ticketSchema = Joi.object({
    flightId: Joi.number().integer().required(),
    returnFlightId: Joi.number().integer().optional(),
    ticketType: Joi.string().valid('One-Way', 'Round-Trip').required(),
    adultCount: Joi.number().integer().min(1).required(),
    childCount: Joi.number().integer().min(0).optional()
});

// Generate seat number
const generateSeatNumber = async (pool, flightId) => {
    const rows = ['A', 'B', 'C', 'D', 'E', 'F'];
    let seatNumber = '';
    let isUnique = false;

    while (!isUnique) {
        const row = rows[Math.floor(Math.random() * rows.length)];
        const seat = Math.floor(Math.random() * 30) + 1;
        seatNumber = `${row}${seat}`;

        const result = await pool.request()
            .input('flightId', sql.Int, flightId)
            .input('seatNumber', sql.NVarChar, seatNumber)
            .query('SELECT COUNT(*) as count FROM [Ticket] WHERE FlightID = @flightId AND SeatNumber = @seatNumber');

        isUnique = result.recordset[0].count === 0;
    }

    return seatNumber;
};

// Create ticket (Book flight)
exports.createTicket = async (req, res, next) => {
    try {
        const { error, value } = ticketSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { flightId, returnFlightId, ticketType, adultCount, childCount = 0 } = value;
        const userId = req.user.userId;

        const pool = await getPool();

        // Get flight details
        const flightResult = await pool.request()
            .input('flightId', sql.Int, flightId)
            .query('SELECT * FROM [FlightList] WHERE FlightID = @flightId');

        if (flightResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy chuyến bay'
            });
        }

        const flight = flightResult.recordset[0];
        const totalPassengers = adultCount + childCount;

        // Check available seats
        if (flight.AvailableSeats < totalPassengers) {
            return res.status(400).json({
                success: false,
                message: 'Không đủ ghế trống cho chuyến bay này'
            });
        }

        // Calculate price
        const adultPrice = flight.Price * adultCount;
        const childPrice = flight.Price * 0.5 * childCount;
        const totalPrice = adultPrice + childPrice;

        // Generate seat number
        const seatNumber = await generateSeatNumber(pool, flightId);

        // Begin transaction
        const transaction = pool.transaction();
        await transaction.begin();

        try {
            // Create ticket
            const ticketResult = await transaction.request()
                .input('userId', sql.Int, userId)
                .input('flightId', sql.Int, flightId)
                .input('bookingDate', sql.DateTime, new Date())
                .input('seatNumber', sql.NVarChar, seatNumber)
                .input('ticketType', sql.NVarChar, ticketType)
                .input('ticketPrice', sql.Decimal(18, 2), totalPrice)
                .input('ticketStatus', sql.NVarChar, 'Queued')
                .input('returnFlightId', sql.Int, returnFlightId || null)
                .query(`
          INSERT INTO [Ticket] 
          (UserID, FlightID, BookingDate, SeatNumber, TicketType, TicketPrice, TicketStatus, ReturnFlightID)
          OUTPUT INSERTED.*
          VALUES (@userId, @flightId, @bookingDate, @seatNumber, @ticketType, @ticketPrice, @ticketStatus, @returnFlightId)
        `);

            const ticket = ticketResult.recordset[0];

            // Update available seats
            await transaction.request()
                .input('flightId', sql.Int, flightId)
                .input('totalPassengers', sql.Int, totalPassengers)
                .query('UPDATE [FlightList] SET AvailableSeats = AvailableSeats - @totalPassengers WHERE FlightID = @flightId');

            // Create notification
            await transaction.request()
                .input('userId', sql.Int, userId)
                .input('message', sql.NVarChar, `Bạn đã đặt vé thành công cho chuyến bay ${flight.FlightNumber}`)
                .input('type', sql.NVarChar, 'TicketBooking')
                .query(`
          INSERT INTO [Notification] (UserID, Message, NotificationType, CreatedDate, IsRead)
          VALUES (@userId, @message, @type, GETDATE(), 0)
        `);

            await transaction.commit();

            res.status(201).json({
                success: true,
                message: 'Đặt vé thành công',
                data: {
                    ticket,
                    flight: {
                        flightNumber: flight.FlightNumber,
                        departure: flight.DepartureAirport,
                        arrival: flight.ArrivalAirport,
                        departureTime: flight.DepartureTime
                    }
                }
            });
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    } catch (error) {
        next(error);
    }
};

// Get tickets
exports.getTickets = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, status, sortBy = 'BookingDate', sortOrder = 'DESC' } = req.query;
        const offset = (page - 1) * limit;

        const pool = await getPool();
        let whereClause = 'WHERE 1=1';
        const request = pool.request()
            .input('limit', sql.Int, parseInt(limit))
            .input('offset', sql.Int, offset);

        // If not admin, only show user's tickets
        if (req.user.role !== 'Admin') {
            whereClause += ' AND t.UserID = @userId';
            request.input('userId', sql.Int, req.user.userId);
        }

        if (status) {
            whereClause += ' AND t.TicketStatus = @status';
            request.input('status', sql.NVarChar, status);
        }

        const validSortColumns = ['BookingDate', 'TicketPrice', 'TicketStatus'];
        const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'BookingDate';
        const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const result = await request.query(`
      SELECT 
        t.TicketID, t.UserID, t.FlightID, t.BookingDate, t.SeatNumber,
        t.TicketType, t.TicketPrice, t.TicketStatus, t.ReturnFlightID,
        u.Username, u.FullName, u.Email,
        f.FlightNumber, f.DepartureAirport, f.DepartureCode, f.ArrivalAirport, 
        f.ArrivalCode, f.DepartureTime, f.ArrivalTime
      FROM [Ticket] t
      INNER JOIN [User] u ON t.UserID = u.UserID
      INNER JOIN [FlightList] f ON t.FlightID = f.FlightID
      ${whereClause}
      ORDER BY t.${sortColumn} ${order}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

        const countResult = await pool.request()
            .input('userId', sql.Int, req.user.userId)
            .input('status', sql.NVarChar, status || '')
            .query(`
        SELECT COUNT(*) as total FROM [Ticket] t ${whereClause}
      `);

        const total = countResult.recordset[0].total;

        res.json({
            success: true,
            data: {
                tickets: result.recordset,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        next(error);
    }
};

// Get ticket by ID
exports.getTicketById = async (req, res, next) => {
    try {
        const { id } = req.params;

        const pool = await getPool();
        const result = await pool.request()
            .input('ticketId', sql.Int, id)
            .query(`
        SELECT 
          t.TicketID, t.UserID, t.FlightID, t.BookingDate, t.SeatNumber,
          t.TicketType, t.TicketPrice, t.TicketStatus, t.ReturnFlightID,
          u.Username, u.FullName, u.Email, u.PhoneNumber,
          f.FlightNumber, f.DepartureAirport, f.DepartureCode, f.ArrivalAirport, 
          f.ArrivalCode, f.DepartureTime, f.ArrivalTime, f.Price
        FROM [Ticket] t
        INNER JOIN [User] u ON t.UserID = u.UserID
        INNER JOIN [FlightList] f ON t.FlightID = f.FlightID
        WHERE t.TicketID = @ticketId
      `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy vé'
            });
        }

        const ticket = result.recordset[0];

        // Check authorization
        if (req.user.role !== 'Admin' && ticket.UserID !== req.user.userId) {
            return res.status(403).json({
                success: false,
                message: 'Bạn không có quyền xem vé này'
            });
        }

        res.json({
            success: true,
            data: ticket
        });
    } catch (error) {
        next(error);
    }
};

// Update ticket (Admin only)
exports.updateTicket = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { ticketStatus, seatNumber } = req.body;

        const pool = await getPool();

        const updateFields = [];
        const request = pool.request().input('ticketId', sql.Int, id);

        if (ticketStatus) {
            updateFields.push('TicketStatus = @ticketStatus');
            request.input('ticketStatus', sql.NVarChar, ticketStatus);
        }
        if (seatNumber) {
            updateFields.push('SeatNumber = @seatNumber');
            request.input('seatNumber', sql.NVarChar, seatNumber);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Không có thông tin để cập nhật'
            });
        }

        const result = await request.query(`
      UPDATE [Ticket]
      SET ${updateFields.join(', ')}
      OUTPUT INSERTED.*
      WHERE TicketID = @ticketId
    `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy vé'
            });
        }

        res.json({
            success: true,
            message: 'Cập nhật vé thành công',
            data: result.recordset[0]
        });
    } catch (error) {
        next(error);
    }
};

// Cancel ticket
exports.cancelTicket = async (req, res, next) => {
    try {
        const { id } = req.params;

        const pool = await getPool();

        // Get ticket details
        const ticketResult = await pool.request()
            .input('ticketId', sql.Int, id)
            .query('SELECT * FROM [Ticket] WHERE TicketID = @ticketId');

        if (ticketResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy vé'
            });
        }

        const ticket = ticketResult.recordset[0];

        // Check authorization
        if (req.user.role !== 'Admin' && ticket.UserID !== req.user.userId) {
            return res.status(403).json({
                success: false,
                message: 'Bạn không có quyền hủy vé này'
            });
        }

        // Check if ticket can be cancelled
        if (ticket.TicketStatus === 'Cancelled') {
            return res.status(400).json({
                success: false,
                message: 'Vé đã bị hủy trước đó'
            });
        }

        // Update ticket status
        await pool.request()
            .input('ticketId', sql.Int, id)
            .query('UPDATE [Ticket] SET TicketStatus = \'Cancelled\' WHERE TicketID = @ticketId');

        // Return seat to flight
        await pool.request()
            .input('flightId', sql.Int, ticket.FlightID)
            .query('UPDATE [FlightList] SET AvailableSeats = AvailableSeats + 1 WHERE FlightID = @flightId');

        res.json({
            success: true,
            message: 'Hủy vé thành công'
        });
    } catch (error) {
        next(error);
    }
};

// Get tickets by user ID
exports.getTicketsByUserId = async (req, res, next) => {
    try {
        const { userId } = req.params;

        // Check authorization
        if (req.user.role !== 'Admin' && req.user.userId !== parseInt(userId)) {
            return res.status(403).json({
                success: false,
                message: 'Bạn không có quyền xem thông tin này'
            });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
        SELECT 
          t.TicketID, t.FlightID, t.BookingDate, t.SeatNumber,
          t.TicketType, t.TicketPrice, t.TicketStatus,
          f.FlightNumber, f.DepartureAirport, f.ArrivalAirport,
          f.DepartureTime, f.ArrivalTime
        FROM [Ticket] t
        INNER JOIN [FlightList] f ON t.FlightID = f.FlightID
        WHERE t.UserID = @userId
        ORDER BY t.BookingDate DESC
      `);

        res.json({
            success: true,
            data: result.recordset
        });
    } catch (error) {
        next(error);
    }
};