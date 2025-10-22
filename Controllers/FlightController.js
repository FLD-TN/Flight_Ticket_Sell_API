const { getPool, sql } = require('../config/database');
const Joi = require('joi');

// Validation schemas
const flightSchema = Joi.object({
    flightNumber: Joi.string().required(),
    departureAirport: Joi.string().required(),
    departureCode: Joi.string().required(),
    arrivalAirport: Joi.string().required(),
    arrivalCode: Joi.string().required(),
    departureTime: Joi.date().required(),
    arrivalTime: Joi.date().required(),
    availableSeats: Joi.number().integer().min(0).required(),
    price: Joi.number().min(0).required()
});

// Search flights
exports.searchFlights = async (req, res, next) => {
    try {
        const {
            departureCode,
            arrivalCode,
            departureDate,
            returnDate,
            passengers = 1,
            page = 1,
            limit = 10
        } = req.query;

        if (!departureCode || !arrivalCode || !departureDate) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng cung cấp đầy đủ thông tin: điểm đi, điểm đến và ngày khởi hành'
            });
        }

        const offset = (page - 1) * limit;
        const pool = await getPool();

        // Search outbound flights
        const outboundQuery = `
      SELECT 
        FlightID, FlightNumber, DepartureAirport, DepartureCode,
        ArrivalAirport, ArrivalCode, DepartureTime, ArrivalTime,
        AvailableSeats, Price, CreatedDate
      FROM [FlightList]
      WHERE DepartureCode = @departureCode
        AND ArrivalCode = @arrivalCode
        AND CAST(DepartureTime AS DATE) = @departureDate
        AND AvailableSeats >= @passengers
      ORDER BY DepartureTime
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `;

        const outboundResult = await pool.request()
            .input('departureCode', sql.NVarChar, departureCode)
            .input('arrivalCode', sql.NVarChar, arrivalCode)
            .input('departureDate', sql.Date, departureDate)
            .input('passengers', sql.Int, parseInt(passengers))
            .input('limit', sql.Int, parseInt(limit))
            .input('offset', sql.Int, offset)
            .query(outboundQuery);

        let returnFlights = [];

        // Search return flights if returnDate provided
        if (returnDate) {
            const returnQuery = `
        SELECT 
          FlightID, FlightNumber, DepartureAirport, DepartureCode,
          ArrivalAirport, ArrivalCode, DepartureTime, ArrivalTime,
          AvailableSeats, Price, CreatedDate
        FROM [FlightList]
        WHERE DepartureCode = @arrivalCode
          AND ArrivalCode = @departureCode
          AND CAST(DepartureTime AS DATE) = @returnDate
          AND AvailableSeats >= @passengers
        ORDER BY DepartureTime
      `;

            const returnResult = await pool.request()
                .input('departureCode', sql.NVarChar, departureCode)
                .input('arrivalCode', sql.NVarChar, arrivalCode)
                .input('returnDate', sql.Date, returnDate)
                .input('passengers', sql.Int, parseInt(passengers))
                .query(returnQuery);

            returnFlights = returnResult.recordset;
        }

        // Get total count
        const countResult = await pool.request()
            .input('departureCode', sql.NVarChar, departureCode)
            .input('arrivalCode', sql.NVarChar, arrivalCode)
            .input('departureDate', sql.Date, departureDate)
            .input('passengers', sql.Int, parseInt(passengers))
            .query(`
        SELECT COUNT(*) as total
        FROM [FlightList]
        WHERE DepartureCode = @departureCode
          AND ArrivalCode = @arrivalCode
          AND CAST(DepartureTime AS DATE) = @departureDate
          AND AvailableSeats >= @passengers
      `);

        const total = countResult.recordset[0].total;

        res.json({
            success: true,
            data: {
                outboundFlights: outboundResult.recordset,
                returnFlights,
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

// Update flight (Admin only)
exports.updateFlight = async (req, res, next) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const pool = await getPool();

        // Check if flight exists
        const flightCheck = await pool.request()
            .input('flightId', sql.Int, id)
            .query('SELECT FlightID FROM [FlightList] WHERE FlightID = @flightId');

        if (flightCheck.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy chuyến bay'
            });
        }

        const updateFields = [];
        const request = pool.request().input('flightId', sql.Int, id);

        if (updateData.flightNumber) {
            updateFields.push('FlightNumber = @flightNumber');
            request.input('flightNumber', sql.NVarChar, updateData.flightNumber);
        }
        if (updateData.departureAirport) {
            updateFields.push('DepartureAirport = @departureAirport');
            request.input('departureAirport', sql.NVarChar, updateData.departureAirport);
        }
        if (updateData.departureCode) {
            updateFields.push('DepartureCode = @departureCode');
            request.input('departureCode', sql.NVarChar, updateData.departureCode);
        }
        if (updateData.arrivalAirport) {
            updateFields.push('ArrivalAirport = @arrivalAirport');
            request.input('arrivalAirport', sql.NVarChar, updateData.arrivalAirport);
        }
        if (updateData.arrivalCode) {
            updateFields.push('ArrivalCode = @arrivalCode');
            request.input('arrivalCode', sql.NVarChar, updateData.arrivalCode);
        }
        if (updateData.departureTime) {
            updateFields.push('DepartureTime = @departureTime');
            request.input('departureTime', sql.DateTime, updateData.departureTime);
        }
        if (updateData.arrivalTime) {
            updateFields.push('ArrivalTime = @arrivalTime');
            request.input('arrivalTime', sql.DateTime, updateData.arrivalTime);
        }
        if (updateData.availableSeats !== undefined) {
            updateFields.push('AvailableSeats = @availableSeats');
            request.input('availableSeats', sql.Int, updateData.availableSeats);
        }
        if (updateData.price !== undefined) {
            updateFields.push('Price = @price');
            request.input('price', sql.Decimal(18, 2), updateData.price);
        }

        updateFields.push('UpdatedDate = GETDATE()');

        const result = await request.query(`
      UPDATE [FlightList]
      SET ${updateFields.join(', ')}
      OUTPUT INSERTED.*
      WHERE FlightID = @flightId
    `);

        res.json({
            success: true,
            message: 'Cập nhật chuyến bay thành công',
            data: result.recordset[0]
        });
    } catch (error) {
        next(error);
    }
};

// Delete flight (Admin only)
exports.deleteFlight = async (req, res, next) => {
    try {
        const { id } = req.params;

        const pool = await getPool();

        // Check if flight has tickets
        const ticketCheck = await pool.request()
            .input('flightId', sql.Int, id)
            .query('SELECT COUNT(*) as count FROM [Ticket] WHERE FlightID = @flightId');

        if (ticketCheck.recordset[0].count > 0) {
            return res.status(400).json({
                success: false,
                message: 'Không thể xóa chuyến bay đã có vé đặt'
            });
        }

        const result = await pool.request()
            .input('flightId', sql.Int, id)
            .query('DELETE FROM [FlightList] WHERE FlightID = @flightId');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy chuyến bay'
            });
        }

        res.json({
            success: true,
            message: 'Xóa chuyến bay thành công'
        });
    } catch (error) {
        next(error);
    }
};

// Get cheapest flights
exports.getCheapestFlights = async (req, res, next) => {
    try {
        const { departureDate, departureAirport, arrivalAirport, limit = 5 } = req.body;

        if (!departureDate || !departureAirport || !arrivalAirport) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng cung cấp đầy đủ thông tin'
            });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input('departureAirport', sql.NVarChar, departureAirport)
            .input('arrivalAirport', sql.NVarChar, arrivalAirport)
            .input('departureDate', sql.Date, departureDate)
            .input('limit', sql.Int, parseInt(limit))
            .query(`
        SELECT TOP (@limit)
          FlightID, FlightNumber, DepartureAirport, ArrivalAirport,
          DepartureTime, ArrivalTime, Price, AvailableSeats
        FROM [FlightList]
        WHERE DepartureAirport = @departureAirport
          AND ArrivalAirport = @arrivalAirport
          AND CAST(DepartureTime AS DATE) = @departureDate
          AND AvailableSeats > 0
        ORDER BY Price ASC
      `);

        res.json({
            success: true,
            data: result.recordset
        });
    } catch (error) {
        next(error);
    }
};

// Get all flights
exports.getAllFlights = async (req, res, next) => {
    try {
        const {
            page = 1,
            limit = 10,
            sortBy = 'DepartureTime',
            sortOrder = 'ASC',
            departureCode,
            arrivalCode
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();

        let whereClause = 'WHERE 1=1';
        const request = pool.request()
            .input('limit', sql.Int, parseInt(limit))
            .input('offset', sql.Int, offset);

        if (departureCode) {
            whereClause += ' AND DepartureCode = @departureCode';
            request.input('departureCode', sql.NVarChar, departureCode);
        }

        if (arrivalCode) {
            whereClause += ' AND ArrivalCode = @arrivalCode';
            request.input('arrivalCode', sql.NVarChar, arrivalCode);
        }

        const validSortColumns = ['FlightNumber', 'DepartureTime', 'ArrivalTime', 'Price', 'AvailableSeats'];
        const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'DepartureTime';
        const order = sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

        const result = await request.query(`
      SELECT 
        FlightID, FlightNumber, DepartureAirport, DepartureCode,
        ArrivalAirport, ArrivalCode, DepartureTime, ArrivalTime,
        AvailableSeats, Price, CreatedDate, UpdatedDate
      FROM [FlightList]
      ${whereClause}
      ORDER BY ${sortColumn} ${order}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

        const countResult = await pool.request().query(`
      SELECT COUNT(*) as total FROM [FlightList] ${whereClause}
    `);

        const total = countResult.recordset[0].total;

        res.json({
            success: true,
            data: {
                flights: result.recordset,
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

// Get flight by ID
exports.getFlightById = async (req, res, next) => {
    try {
        const { id } = req.params;

        const pool = await getPool();
        const result = await pool.request()
            .input('flightId', sql.Int, id)
            .query(`
        SELECT 
          FlightID, FlightNumber, DepartureAirport, DepartureCode,
          ArrivalAirport, ArrivalCode, DepartureTime, ArrivalTime,
          AvailableSeats, Price, CreatedDate, UpdatedDate
        FROM [FlightList]
        WHERE FlightID = @flightId
      `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy chuyến bay'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });
    } catch (error) {
        next(error);
    }
};

// Get flight by flight number
exports.getFlightByNumber = async (req, res, next) => {
    try {
        const { flightNumber } = req.params;

        const pool = await getPool();
        const result = await pool.request()
            .input('flightNumber', sql.NVarChar, flightNumber)
            .query(`
        SELECT 
          FlightID, FlightNumber, DepartureAirport, DepartureCode,
          ArrivalAirport, ArrivalCode, DepartureTime, ArrivalTime,
          AvailableSeats, Price, CreatedDate, UpdatedDate
        FROM [FlightList]
        WHERE FlightNumber = @flightNumber
      `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy chuyến bay'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });
    } catch (error) {
        next(error);
    }
};

// Create flight (Admin only)
exports.createFlight = async (req, res, next) => {
    try {
        const { error, value } = flightSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const pool = await getPool();

        // Check if flight number exists
        const existingFlight = await pool.request()
            .input('flightNumber', sql.NVarChar, value.flightNumber)
            .query('SELECT FlightID FROM [FlightList] WHERE FlightNumber = @flightNumber');

        if (existingFlight.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Số hiệu chuyến bay đã tồn tại'
            });
        }

        const result = await pool.request()
            .input('flightNumber', sql.NVarChar, value.flightNumber)
            .input('departureAirport', sql.NVarChar, value.departureAirport)
            .input('departureCode', sql.NVarChar, value.departureCode)
            .input('arrivalAirport', sql.NVarChar, value.arrivalAirport)
            .input('arrivalCode', sql.NVarChar, value.arrivalCode)
            .input('departureTime', sql.DateTime, value.departureTime)
            .input('arrivalTime', sql.DateTime, value.arrivalTime)
            .input('availableSeats', sql.Int, value.availableSeats)
            .input('price', sql.Decimal(18, 2), value.price)
            .query(`
        INSERT INTO [FlightList] 
        (FlightNumber, DepartureAirport, DepartureCode, ArrivalAirport, ArrivalCode, 
         DepartureTime, ArrivalTime, AvailableSeats, Price, CreatedDate, UpdatedDate)
        OUTPUT INSERTED.*
        VALUES 
        (@flightNumber, @departureAirport, @departureCode, @arrivalAirport, @arrivalCode,
         @departureTime, @arrivalTime, @availableSeats, @price, GETDATE(), GETDATE())
        `);

        res.status(201).json({
            success: true,
            message: 'Tạo chuyến bay thành công',
            data: result.recordset[0]
        });
    } catch (error) {
        next(error);
    }
};