const crypto = require('crypto');
const axios = require('axios');
const { getPool, sql } = require('../config/database');
const Joi = require('joi');

// Validation schema
const paymentSchema = Joi.object({
    orderId: Joi.number().integer().required(),
    amount: Joi.number().min(1000).required(),
    orderInfo: Joi.string().optional()
});

// ============ MOMO PAYMENT ============

// Generate MoMo signature
const generateMomoSignature = (data) => {
    const {
        accessKey,
        amount,
        extraData,
        ipnUrl,
        orderId,
        orderInfo,
        partnerCode,
        redirectUrl,
        requestId,
        requestType
    } = data;

    const rawSignature = `accessKey=${accessKey}&amount=${amount}&extraData=${extraData}&ipnUrl=${ipnUrl}&orderId=${orderId}&orderInfo=${orderInfo}&partnerCode=${partnerCode}&redirectUrl=${redirectUrl}&requestId=${requestId}&requestType=${requestType}`;

    return crypto
        .createHmac('sha256', process.env.MOMO_SECRET_KEY)
        .update(rawSignature)
        .digest('hex');
};

// Create MoMo payment
exports.createMomoPayment = async (req, res, next) => {
    try {
        const { error, value } = paymentSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { orderId, amount } = value;
        const userId = req.user.userId;

        const pool = await getPool();

        // Verify order belongs to user
        const orderResult = await pool.request()
            .input('orderId', sql.Int, orderId)
            .input('userId', sql.Int, userId)
            .query('SELECT * FROM [Order] WHERE OrderID = @orderId AND UserID = @userId');

        if (orderResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy đơn hàng'
            });
        }

        const order = orderResult.recordset[0];

        // Check if order already paid
        if (order.PaymentStatus === 'Paid') {
            return res.status(400).json({
                success: false,
                message: 'Đơn hàng đã được thanh toán'
            });
        }

        const amountVND = Math.floor(amount * 10000);

        if (amountVND < 1000 || amountVND > 50000000) {
            return res.status(400).json({
                success: false,
                message: 'Số tiền không hợp lệ. Tối thiểu 1,000đ và tối đa 50,000,000đ'
            });
        }

        const requestId = `${orderId}_${Date.now()}`;
        const orderIdMomo = `${orderId}_${Date.now()}`;

        const paymentData = {
            partnerCode: process.env.MOMO_PARTNER_CODE,
            partnerName: 'Flight Booking System',
            storeId: 'FlightBooking',
            requestType: 'captureWallet',
            ipnUrl: process.env.MOMO_NOTIFY_URL,
            redirectUrl: process.env.MOMO_RETURN_URL,
            orderId: orderIdMomo,
            amount: amountVND.toString(),
            lang: 'vi',
            orderInfo: `Thanh toán đơn hàng #${orderId}`,
            requestId: requestId,
            extraData: '',
            accessKey: process.env.MOMO_ACCESS_KEY
        };

        const signature = generateMomoSignature(paymentData);

        const requestBody = {
            ...paymentData,
            signature
        };

        const response = await axios.post(process.env.MOMO_API_URL, requestBody, {
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data.resultCode === 0) {
            res.json({
                success: true,
                message: 'Tạo link thanh toán thành công',
                data: {
                    payUrl: response.data.payUrl,
                    orderId: orderIdMomo,
                    requestId
                }
            });
        } else {
            res.status(400).json({
                success: false,
                message: response.data.message || 'Không thể tạo thanh toán'
            });
        }
    } catch (error) {
        next(error);
    }
};

// MoMo callback
exports.momoCallback = async (req, res, next) => {
    try {
        const { orderId, resultCode, message } = req.query;

        if (resultCode === '0') {
            // Payment successful
            res.send(`
        <html>
          <head><title>Thanh toán thành công</title></head>
          <body>
            <h1>✅ Thanh toán thành công!</h1>
            <p>Mã đơn hàng: ${orderId}</p>
            <p>Cảm ơn bạn đã sử dụng dịch vụ!</p>
          </body>
        </html>
      `);
        } else {
            res.send(`
        <html>
          <head><title>Thanh toán thất bại</title></head>
          <body>
            <h1>❌ Thanh toán thất bại</h1>
            <p>Lý do: ${message}</p>
          </body>
        </html>
      `);
        }
    } catch (error) {
        next(error);
    }
};

// MoMo IPN
exports.momoIPN = async (req, res, next) => {
    try {
        const { orderId, resultCode, signature } = req.body;

        // Verify signature
        const expectedSignature = generateMomoSignature(req.body);

        if (signature !== expectedSignature) {
            return res.status(400).send('Invalid signature');
        }

        if (resultCode === 0) {
            // Extract original order ID
            const originalOrderId = orderId.split('_')[0];

            const pool = await getPool();
            await pool.request()
                .input('orderId', sql.Int, parseInt(originalOrderId))
                .query(`
          UPDATE [Order]
          SET PaymentStatus = 'Paid', OrderStatus = 'Processing', UpdatedDate = GETDATE()
          WHERE OrderID = @orderId
        `);

            // Create notification
            const orderResult = await pool.request()
                .input('orderId', sql.Int, parseInt(originalOrderId))
                .query('SELECT UserID FROM [Order] WHERE OrderID = @orderId');

            if (orderResult.recordset.length > 0) {
                const userId = orderResult.recordset[0].UserID;
                await pool.request()
                    .input('userId', sql.Int, userId)
                    .input('message', sql.NVarChar, `Thanh toán đơn hàng #${originalOrderId} thành công qua MoMo`)
                    .input('type', sql.NVarChar, 'PaymentSuccess')
                    .query(`
            INSERT INTO [Notification] (UserID, Message, NotificationType, CreatedDate, IsRead)
            VALUES (@userId, @message, @type, GETDATE(), 0)
          `);
            }
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('MoMo IPN Error:', error);
        res.status(500).send('ERROR');
    }
};

// ============ VNPAY PAYMENT ============

// Sort object by key
const sortObject = (obj) => {
    const sorted = {};
    const keys = Object.keys(obj).sort();
    keys.forEach(key => {
        sorted[key] = obj[key];
    });
    return sorted;
};

// Generate VNPAY signature
const generateVNPaySignature = (params, secretKey) => {
    const sortedParams = sortObject(params);
    const signData = Object.keys(sortedParams)
        .map(key => `${key}=${sortedParams[key]}`)
        .join('&');

    return crypto
        .createHmac('sha512', secretKey)
        .update(signData)
        .digest('hex');
};

// Create VNPAY payment
exports.createVNPayPayment = async (req, res, next) => {
    try {
        const { error, value } = paymentSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { orderId, amount } = value;
        const userId = req.user.userId;

        const pool = await getPool();

        // Verify order
        const orderResult = await pool.request()
            .input('orderId', sql.Int, orderId)
            .input('userId', sql.Int, userId)
            .query('SELECT * FROM [Order] WHERE OrderID = @orderId AND UserID = @userId');

        if (orderResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy đơn hàng'
            });
        }

        const order = orderResult.recordset[0];

        if (order.PaymentStatus === 'Paid') {
            return res.status(400).json({
                success: false,
                message: 'Đơn hàng đã được thanh toán'
            });
        }

        const amountVND = Math.floor(amount * 100); // VNPAY requires amount * 100
        const createDate = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
        const txnRef = `${orderId}_${Date.now()}`;

        const vnpParams = {
            vnp_Version: '2.1.0',
            vnp_Command: 'pay',
            vnp_TmnCode: process.env.VNPAY_TMN_CODE,
            vnp_Amount: amountVND.toString(),
            vnp_CreateDate: createDate,
            vnp_CurrCode: 'VND',
            vnp_IpAddr: req.ip || '127.0.0.1',
            vnp_Locale: 'vn',
            vnp_OrderInfo: `Thanh toan don hang #${orderId}`,
            vnp_OrderType: 'billpayment',
            vnp_ReturnUrl: process.env.VNPAY_RETURN_URL,
            vnp_TxnRef: txnRef
        };

        const signature = generateVNPaySignature(vnpParams, process.env.VNPAY_HASH_SECRET);
        vnpParams.vnp_SecureHash = signature;

        const queryString = Object.keys(vnpParams)
            .map(key => `${key}=${encodeURIComponent(vnpParams[key])}`)
            .join('&');

        const paymentUrl = `${process.env.VNPAY_URL}?${queryString}`;

        res.json({
            success: true,
            message: 'Tạo link thanh toán thành công',
            data: {
                payUrl: paymentUrl,
                txnRef
            }
        });
    } catch (error) {
        next(error);
    }
};

// VNPAY callback
exports.vnpayCallback = async (req, res, next) => {
    try {
        const vnpParams = { ...req.query };
        const secureHash = vnpParams.vnp_SecureHash;

        delete vnpParams.vnp_SecureHash;
        delete vnpParams.vnp_SecureHashType;

        const signature = generateVNPaySignature(vnpParams, process.env.VNPAY_HASH_SECRET);

        if (secureHash !== signature) {
            return res.send(`
        <html>
          <head><title>Xác thực thất bại</title></head>
          <body>
            <h1>❌ Không xác thực được chữ ký!</h1>
          </body>
        </html>
      `);
        }

        const { vnp_TxnRef, vnp_ResponseCode } = vnpParams;
        const originalOrderId = vnp_TxnRef.split('_')[0];

        if (vnp_ResponseCode === '00') {
            const pool = await getPool();

            // Update order status
            await pool.request()
                .input('orderId', sql.Int, parseInt(originalOrderId))
                .query(`
          UPDATE [Order]
          SET PaymentStatus = 'Paid', OrderStatus = 'Processing', UpdatedDate = GETDATE()
          WHERE OrderID = @orderId
        `);

            // Create notification
            const orderResult = await pool.request()
                .input('orderId', sql.Int, parseInt(originalOrderId))
                .query('SELECT UserID FROM [Order] WHERE OrderID = @orderId');

            if (orderResult.recordset.length > 0) {
                const userId = orderResult.recordset[0].UserID;
                await pool.request()
                    .input('userId', sql.Int, userId)
                    .input('message', sql.NVarChar, `Thanh toán đơn hàng #${originalOrderId} thành công qua VNPAY`)
                    .input('type', sql.NVarChar, 'PaymentSuccess')
                    .query(`
            INSERT INTO [Notification] (UserID, Message, NotificationType, CreatedDate, IsRead)
            VALUES (@userId, @message, @type, GETDATE(), 0)
          `);
            }

            res.send(`
        <html>
          <head><title>Thanh toán thành công</title></head>
          <body>
            <h1>✅ Thanh toán thành công!</h1>
            <p>Mã đơn hàng: ${originalOrderId}</p>
            <p>Cảm ơn bạn đã sử dụng dịch vụ!</p>
          </body>
        </html>
      `);
        } else {
            res.send(`
        <html>
          <head><title>Thanh toán thất bại</title></head>
          <body>
            <h1>❌ Thanh toán thất bại</h1>
            <p>Mã lỗi: ${vnp_ResponseCode}</p>
          </body>
        </html>
      `);
        }
    } catch (error) {
        next(error);
    }
};