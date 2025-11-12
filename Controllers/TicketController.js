const { getPool, sql } = require('../config/database');
const Joi = require('joi');


const passengerSchema = Joi.object({
    fullName: Joi.string().required(),
    dateOfBirth: Joi.date().required(),
    idNumber: Joi.string().required(),
    passengerType: Joi.string().valid('Adult', 'Child').required()
});
// Validation schema
const ticketSchema = Joi.object({
    flightId: Joi.number().integer().required(),
    returnFlightId: Joi.number().integer().optional(),
    ticketType: Joi.string().valid('One-Way', 'Round-Trip').required(),
    adultCount: Joi.number().integer().min(1).required(),
    childCount: Joi.number().integer().min(0).optional(),

    // Thêm trường này: yêu cầu một mảng hành khách, tối thiểu 1
    passengers: Joi.array().items(passengerSchema).min(1).required()
}).unknown(true);

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

        // Lấy dữ liệu mới từ 'value'
        const { flightId, returnFlightId, ticketType, adultCount, childCount = 0, passengers } = value;
        const userId = req.user.userId;

        // Kiểm tra số lượng hành khách có khớp không
        if (passengers.length !== (adultCount + childCount)) {
            return res.status(400).json({
                success: false,
                message: 'Số lượng hành khách không khớp với danh sách chi tiết.'
            });
        }

        const pool = await getPool();

        // ... (Logic kiểm tra chuyến bay, kiểm tra ghế trống giữ nguyên) ...

        const flightResult = await pool.request()
            .input('flightId', sql.Int, flightId)
            .query('SELECT * FROM [FlightList] WHERE FlightID = @flightId');

        // ... (Các kiểm tra khác giữ nguyên) ...
        const flight = flightResult.recordset[0];
        const totalPassengers = adultCount + childCount;

        if (flight.AvailableSeats < totalPassengers) {
            return res.status(400).json({
                success: false,
                message: 'Không đủ ghế trống cho chuyến bay này'
            });
        }

        // ... (Logic tính giá, tạo seat number giữ nguyên) ...
        const adultPrice = flight.Price * adultCount;
        const childPrice = flight.Price * 0.5 * childCount;
        const totalPrice = adultPrice + childPrice;
        const seatNumber = await generateSeatNumber(pool, flightId);

        // Begin transaction
        const transaction = pool.transaction();
        await transaction.begin();

        try {
            // Create ticket (Giống như cũ)
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
            const newTicketId = ticket.TicketID;

            // ✅ BƯỚC 2.4: THÊM VÒNG LẶP ĐỂ LƯU HÀNH KHÁCH
            for (const passenger of passengers) {
                await transaction.request()
                    .input('ticketId', sql.Int, newTicketId)
                    .input('fullName', sql.NVarChar, passenger.fullName)
                    .input('dateOfBirth', sql.Date, new Date(passenger.dateOfBirth))
                    .input('idNumber', sql.NVarChar, passenger.idNumber)
                    .input('passengerType', sql.NVarChar, passenger.passengerType)
                    .query(`
                        INSERT INTO [PassengerDetails] (TicketID, FullName, DateOfBirth, IDNumber, PassengerType)
                        VALUES (@ticketId, @fullName, @dateOfBirth, @idNumber, @passengerType)
                    `);
            }
            // KẾT THÚC THÊM MỚI

            // ... (Phần Update AvailableSeats và Create Notification giữ nguyên) ...
            await transaction.request()
                .input('flightId', sql.Int, flightId)
                .input('totalPassengers', sql.Int, totalPassengers)
                .query('UPDATE [FlightList] SET AvailableSeats = AvailableSeats - @totalPassengers WHERE FlightID = @flightId');

            await transaction.commit();

            res.status(201).json({
                success: true,
                message: 'Đặt vé thành công',
                data: { ticket, flight: { /* ... */ } }
            });
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    } catch (error) {
        next(error);
    }
};
// ✅ FIXED: Get tickets - Returns nested structure with Flight object
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
        f.FlightID as FlightFlightID, f.FlightNumber, f.DepartureAirport, f.DepartureCode, 
        f.ArrivalAirport, f.ArrivalCode, f.DepartureTime, f.ArrivalTime, f.Price,
        f.AvailableSeats, f.TotalSeats
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

        // ✅ FIXED: Transform flat structure to nested structure with Flight object
        const tickets = result.recordset.map(row => ({
            TicketID: row.TicketID,
            UserID: row.UserID,
            FlightID: row.FlightID,
            BookingDate: row.BookingDate,
            SeatNumber: row.SeatNumber,
            TicketType: row.TicketType,
            TicketPrice: row.TicketPrice,
            TotalPrice: row.TicketPrice, // Map TicketPrice to TotalPrice for compatibility
            TicketStatus: row.TicketStatus,
            ReturnFlightID: row.ReturnFlightID,
            AdultCount: 1, // Default value - you can store this in DB if needed
            ChildCount: 0,  // Default value - you can store this in DB if needed
            Flight: {
                FlightID: row.FlightFlightID,
                FlightNumber: row.FlightNumber,
                DepartureAirport: row.DepartureAirport,
                DepartureCode: row.DepartureCode,
                ArrivalAirport: row.ArrivalAirport,
                ArrivalCode: row.ArrivalCode,
                DepartureTime: row.DepartureTime,
                ArrivalTime: row.ArrivalTime,
                Price: row.Price,
                AvailableSeats: row.AvailableSeats,
                TotalSeats: row.TotalSeats
            }
        }));

        res.json({
            success: true,
            data: tickets // ✅ Return flat array, not nested in "tickets" property
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

// lấy vé thông qua userID
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