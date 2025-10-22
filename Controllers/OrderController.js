const { getPool, sql } = require('../config/database');
const Joi = require('joi');

// Validation schema
const orderSchema = Joi.object({
    ticketId: Joi.number().integer().required(),
    addressDelivery: Joi.string().required(),
    paymentMethod: Joi.string().valid('Credit Card', 'MoMo', 'VNPAY', 'Cash').required()
});

// Create order
exports.createOrder = async (req, res, next) => {
    try {
        const { error, value } = orderSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { ticketId, addressDelivery, paymentMethod } = value;
        const userId = req.user.userId;

        const pool = await getPool();

        // Get ticket details
        const ticketResult = await pool.request()
            .input('ticketId', sql.Int, ticketId)
            .query('SELECT * FROM [Ticket] WHERE TicketID = @ticketId');

        if (ticketResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy vé'
            });
        }

        const ticket = ticketResult.recordset[0];

        // Verify ticket belongs to user
        if (ticket.UserID !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Vé không thuộc về bạn'
            });
        }

        const transaction = pool.transaction();
        await transaction.begin();

        try {
            // Create order
            const orderResult = await transaction.request()
                .input('userId', sql.Int, userId)
                .input('orderDate', sql.DateTime, new Date())
                .input('totalAmount', sql.Decimal(18, 2), ticket.TicketPrice)
                .input('addressDelivery', sql.NVarChar, addressDelivery)
                .input('paymentMethod', sql.NVarChar, paymentMethod)
                .input('orderStatus', sql.NVarChar, 'Pending')
                .input('paymentStatus', sql.NVarChar, 'Pending')
                .query(`
          INSERT INTO [Order] (UserID, OrderDate, TotalAmount, AddressDelivery, PaymentMethod, OrderStatus, PaymentStatus, CreatedDate)
          OUTPUT INSERTED.*
          VALUES (@userId, @orderDate, @totalAmount, @addressDelivery, @paymentMethod, @orderStatus, @paymentStatus, GETDATE())
        `);

            const order = orderResult.recordset[0];

            // Create order detail
            await transaction.request()
                .input('orderId', sql.Int, order.OrderID)
                .input('ticketId', sql.Int, ticketId)
                .input('quantity', sql.Int, 1)
                .input('unitPrice', sql.Decimal(18, 2), ticket.TicketPrice)
                .input('discount', sql.Decimal(18, 2), 0)
                .query(`
          INSERT INTO [OrderDetail] (OrderID, TicketID, Quantity, UnitPrice, Discount, CreatedDate)
          VALUES (@orderId, @ticketId, @quantity, @unitPrice, @discount, GETDATE())
        `);

            // Create notification
            await transaction.request()
                .input('userId', sql.Int, userId)
                .input('message', sql.NVarChar, `Bạn đã tạo đơn hàng thành công với mã đơn hàng #${order.OrderID}. Tổng tiền: ${(order.TotalAmount * 10000).toLocaleString('vi-VN')}đ`)
                .input('type', sql.NVarChar, 'OrderCreated')
                .query(`
          INSERT INTO [Notification] (UserID, Message, NotificationType, CreatedDate, IsRead)
          VALUES (@userId, @message, @type, GETDATE(), 0)
        `);

            await transaction.commit();

            res.status(201).json({
                success: true,
                message: 'Tạo đơn hàng thành công',
                data: order
            });
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    } catch (error) {
        next(error);
    }
};

// Get orders
exports.getOrders = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, status, paymentStatus } = req.query;
        const offset = (page - 1) * limit;

        const pool = await getPool();
        let whereClause = 'WHERE o.IsDeleted = 0 OR o.IsDeleted IS NULL';
        const request = pool.request()
            .input('limit', sql.Int, parseInt(limit))
            .input('offset', sql.Int, offset);

        // If not admin, only show user's orders
        if (req.user.role !== 'Admin') {
            whereClause += ' AND o.UserID = @userId';
            request.input('userId', sql.Int, req.user.userId);
        }

        if (status) {
            whereClause += ' AND o.OrderStatus = @status';
            request.input('status', sql.NVarChar, status);
        }

        if (paymentStatus) {
            whereClause += ' AND o.PaymentStatus = @paymentStatus';
            request.input('paymentStatus', sql.NVarChar, paymentStatus);
        }

        const result = await request.query(`
      SELECT 
        o.OrderID, o.UserID, o.OrderDate, o.TotalAmount, o.PaymentStatus,
        o.AddressDelivery, o.PaymentMethod, o.OrderStatus, o.CreatedDate,
        u.Username, u.FullName, u.Email
      FROM [Order] o
      INNER JOIN [User] u ON o.UserID = u.UserID
      ${whereClause}
      ORDER BY o.OrderDate DESC
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

        const countResult = await pool.request()
            .input('userId', sql.Int, req.user.userId)
            .input('status', sql.NVarChar, status || '')
            .input('paymentStatus', sql.NVarChar, paymentStatus || '')
            .query(`SELECT COUNT(*) as total FROM [Order] o ${whereClause}`);

        const total = countResult.recordset[0].total;

        res.json({
            success: true,
            data: {
                orders: result.recordset,
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

// Get order by ID
exports.getOrderById = async (req, res, next) => {
    try {
        const { id } = req.params;

        const pool = await getPool();
        const result = await pool.request()
            .input('orderId', sql.Int, id)
            .query(`
        SELECT 
          o.OrderID, o.UserID, o.OrderDate, o.TotalAmount, o.PaymentStatus,
          o.AddressDelivery, o.PaymentMethod, o.OrderStatus, o.CreatedDate,
          u.Username, u.FullName, u.Email, u.PhoneNumber
        FROM [Order] o
        INNER JOIN [User] u ON o.UserID = u.UserID
        WHERE o.OrderID = @orderId AND (o.IsDeleted = 0 OR o.IsDeleted IS NULL)
      `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy đơn hàng'
            });
        }

        const order = result.recordset[0];

        // Check authorization
        if (req.user.role !== 'Admin' && order.UserID !== req.user.userId) {
            return res.status(403).json({
                success: false,
                message: 'Bạn không có quyền xem đơn hàng này'
            });
        }

        // Get order details
        const detailsResult = await pool.request()
            .input('orderId', sql.Int, id)
            .query(`
        SELECT 
          od.OrderDetailID, od.OrderID, od.TicketID, od.Quantity, od.UnitPrice, od.Discount, od.TotalPrice,
          t.SeatNumber, t.TicketType, t.TicketStatus,
          f.FlightNumber, f.DepartureAirport, f.ArrivalAirport, f.DepartureTime, f.ArrivalTime
        FROM [OrderDetail] od
        INNER JOIN [Ticket] t ON od.TicketID = t.TicketID
        INNER JOIN [FlightList] f ON t.FlightID = f.FlightID
        WHERE od.OrderID = @orderId
      `);

        res.json({
            success: true,
            data: {
                ...order,
                orderDetails: detailsResult.recordset
            }
        });
    } catch (error) {
        next(error);
    }
};

// Update order
exports.updateOrder = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { orderStatus, paymentStatus } = req.body;

        const pool = await getPool();

        // Get order
        const orderResult = await pool.request()
            .input('orderId', sql.Int, id)
            .query('SELECT * FROM [Order] WHERE OrderID = @orderId');

        if (orderResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy đơn hàng'
            });
        }

        const order = orderResult.recordset[0];

        // Check authorization
        if (req.user.role !== 'Admin' && order.UserID !== req.user.userId) {
            return res.status(403).json({
                success: false,
                message: 'Bạn không có quyền cập nhật đơn hàng này'
            });
        }

        const updateFields = [];
        const request = pool.request().input('orderId', sql.Int, id);

        if (orderStatus) {
            updateFields.push('OrderStatus = @orderStatus');
            request.input('orderStatus', sql.NVarChar, orderStatus);
        }

        if (paymentStatus) {
            updateFields.push('PaymentStatus = @paymentStatus');
            request.input('paymentStatus', sql.NVarChar, paymentStatus);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Không có thông tin để cập nhật'
            });
        }

        updateFields.push('UpdatedDate = GETDATE()');

        const result = await request.query(`
      UPDATE [Order]
      SET ${updateFields.join(', ')}
      OUTPUT INSERTED.*
      WHERE OrderID = @orderId
    `);

        res.json({
            success: true,
            message: 'Cập nhật đơn hàng thành công',
            data: result.recordset[0]
        });
    } catch (error) {
        next(error);
    }
};

// Cancel order
exports.cancelOrder = async (req, res, next) => {
    try {
        const { id } = req.params;

        const pool = await getPool();

        // Get order
        const orderResult = await pool.request()
            .input('orderId', sql.Int, id)
            .query('SELECT * FROM [Order] WHERE OrderID = @orderId');

        if (orderResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy đơn hàng'
            });
        }

        const order = orderResult.recordset[0];

        // Check authorization
        if (req.user.role !== 'Admin' && order.UserID !== req.user.userId) {
            return res.status(403).json({
                success: false,
                message: 'Bạn không có quyền hủy đơn hàng này'
            });
        }

        // Check if order can be cancelled
        if (order.OrderStatus === 'Completed' || order.OrderStatus === 'Canceled') {
            return res.status(400).json({
                success: false,
                message: 'Không thể hủy đơn hàng này'
            });
        }

        // Update order status
        await pool.request()
            .input('orderId', sql.Int, id)
            .query(`
        UPDATE [Order] 
        SET OrderStatus = 'Canceled', IsDeleted = 1, UpdatedDate = GETDATE()
        WHERE OrderID = @orderId
      `);

        res.json({
            success: true,
            message: 'Hủy đơn hàng thành công'
        });
    } catch (error) {
        next(error);
    }
};

// Get orders by user ID
exports.getOrdersByUserId = async (req, res, next) => {
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
          o.OrderID, o.OrderDate, o.TotalAmount, o.PaymentStatus,
          o.PaymentMethod, o.OrderStatus, o.AddressDelivery
        FROM [Order] o
        WHERE o.UserID = @userId AND (o.IsDeleted = 0 OR o.IsDeleted IS NULL)
        ORDER BY o.OrderDate DESC
      `);

        res.json({
            success: true,
            data: result.recordset
        });
    } catch (error) {
        next(error);
    }
};

// Get invoice
exports.getInvoice = async (req, res, next) => {
    try {
        const { id } = req.params;

        const pool = await getPool();

        // Get order with user info
        const orderResult = await pool.request()
            .input('orderId', sql.Int, id)
            .query(`
        SELECT 
          o.OrderID, o.OrderDate, o.TotalAmount, o.PaymentStatus,
          o.AddressDelivery, o.PaymentMethod, o.OrderStatus,
          u.UserID, u.FullName, u.Email, u.PhoneNumber
        FROM [Order] o
        INNER JOIN [User] u ON o.UserID = u.UserID
        WHERE o.OrderID = @orderId
      `);

        if (orderResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy đơn hàng'
            });
        }

        const order = orderResult.recordset[0];

        // Check authorization
        if (req.user.role !== 'Admin' && order.UserID !== req.user.userId) {
            return res.status(403).json({
                success: false,
                message: 'Bạn không có quyền xem hóa đơn này'
            });
        }

        // Get order details with ticket and flight info
        const detailsResult = await pool.request()
            .input('orderId', sql.Int, id)
            .query(`
        SELECT 
          od.OrderDetailID, od.Quantity, od.UnitPrice, od.Discount, od.TotalPrice,
          t.TicketID, t.SeatNumber, t.TicketType, t.TicketStatus,
          f.FlightID, f.FlightNumber, f.DepartureAirport, f.DepartureCode,
          f.ArrivalAirport, f.ArrivalCode, f.DepartureTime, f.ArrivalTime
        FROM [OrderDetail] od
        INNER JOIN [Ticket] t ON od.TicketID = t.TicketID
        INNER JOIN [FlightList] f ON t.FlightID = f.FlightID
        WHERE od.OrderID = @orderId
      `);

        res.json({
            success: true,
            data: {
                order,
                items: detailsResult.recordset,
                totalAmountVND: order.TotalAmount * 10000
            }
        });
    } catch (error) {
        next(error);
    }
};