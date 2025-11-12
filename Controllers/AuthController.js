const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getPool, sql } = require('../config/database');
const Joi = require('joi');

// Validation schemas
const registerSchema = Joi.object({
    fullName: Joi.string().min(2).max(100).required(),
    username: Joi.string().alphanum().min(3).max(50).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).max(100).required(),
    phoneNumber: Joi.string().pattern(/^[0-9]{10,15}$/).optional()
});

const loginSchema = Joi.object({
    emailOrUsername: Joi.string().required(),
    password: Joi.string().required()
});

// Generate JWT tokens
const generateTokens = (user) => {
    const accessToken = jwt.sign(
        {
            userId: user.UserID,
            username: user.Username,
            email: user.Email,
            role: user.UserRole
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    const refreshToken = jwt.sign(
        { userId: user.UserID },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
    );

    return { accessToken, refreshToken };
};

// Register new user
exports.register = async (req, res, next) => {
    try {
        const { error, value } = registerSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { fullName, username, email, password, phoneNumber } = value;

        const pool = await getPool();

        // Check if user already exists
        const existingUser = await pool.request()
            .input('email', sql.NVarChar, email)
            .input('username', sql.NVarChar, username)
            .query('SELECT UserID FROM [User] WHERE Email = @email OR Username = @username');

        if (existingUser.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Email hoặc username đã tồn tại'
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert new user
        const result = await pool.request()
            .input('fullName', sql.NVarChar, fullName)
            .input('username', sql.NVarChar, username)
            .input('email', sql.NVarChar, email)
            .input('password', sql.NVarChar, hashedPassword)
            .input('phoneNumber', sql.NVarChar, phoneNumber || null)
            .input('userRole', sql.NVarChar, 'User')
            .input('avatar', sql.NVarChar, '/Images/Avatars/default.png')
            .query(`
        INSERT INTO [User] (FullName, Username, Email, Password, PhoneNumber, UserRole, Avatar, CreatedDate)
        OUTPUT INSERTED.UserID, INSERTED.Username, INSERTED.Email, INSERTED.FullName, INSERTED.UserRole
        VALUES (@fullName, @username, @email, @password, @phoneNumber, @userRole, @avatar, GETDATE())
      `);

        const newUser = result.recordset[0];

        // Create welcome notification
        await pool.request()
            .input('userId', sql.Int, newUser.UserID)
            .input('message', sql.NVarChar, 'Tài khoản tạo thành công!')
            .input('type', sql.NVarChar, 'AccountRegistration')
            .query(`
        INSERT INTO [Notification] (UserID, Message, NotificationType, CreatedDate, IsRead)
        VALUES (@userId, @message, @type, GETDATE(), 0)
      `);

        // Generate tokens
        const tokens = generateTokens(newUser);

        res.status(201).json({
            success: true,
            message: 'Đăng ký thành công',
            data: {
                user: {
                    userId: newUser.UserID,
                    username: newUser.Username,
                    email: newUser.Email,
                    fullName: newUser.FullName,
                    role: newUser.UserRole
                },
                ...tokens
            }
        });
    } catch (error) {
        next(error);
    }
};

// đăng nhập của user
exports.login = async (req, res, next) => {
    try {
        const { error, value } = loginSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { emailOrUsername, password } = value;

        const pool = await getPool();

        // Tìm user thông qua email hoặc username
        const result = await pool.request()
            .input('identifier', sql.NVarChar, emailOrUsername)
            .query(`
        SELECT UserID, Username, Email, Password, FullName, UserRole, Avatar, PhoneNumber
        FROM [User]
        WHERE Email = @identifier OR Username = @identifier
      `);

        if (result.recordset.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Tên đăng nhập hoặc mật khẩu không đúng'
            });
        }

        const user = result.recordset[0];

        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.Password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Tên đăng nhập hoặc mật khẩu không đúng'
            });
        }

        // Generate tokens
        const tokens = generateTokens(user);

        res.json({
            success: true,
            message: 'Đăng nhập thành công',
            data: {
                user: {
                    userId: user.UserID,
                    username: user.Username,
                    email: user.Email,
                    fullName: user.FullName,
                    role: user.UserRole,
                    avatar: user.Avatar,
                    phoneNumber: user.PhoneNumber
                },
                ...tokens
            }
        });
    } catch (error) {
        next(error);
    }
};

// Refresh token
exports.refreshToken = async (req, res, next) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({
                success: false,
                message: 'Refresh token is required'
            });
        }

        try {
            const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

            const pool = await getPool();
            const result = await pool.request()
                .input('userId', sql.Int, decoded.userId)
                .query('SELECT UserID, Username, Email, UserRole FROM [User] WHERE UserID = @userId');

            if (result.recordset.length === 0) {
                return res.status(401).json({
                    success: false,
                    message: 'User not found'
                });
            }

            const user = result.recordset[0];
            const tokens = generateTokens(user);

            res.json({
                success: true,
                data: tokens
            });
        } catch (error) {
            return res.status(401).json({
                success: false,
                message: 'Invalid refresh token'
            });
        }
    } catch (error) {
        next(error);
    }
};

// Logout
exports.logout = async (req, res) => {
    res.json({
        success: true,
        message: 'Đăng xuất thành công'
    });
};

// Get current user
exports.getCurrentUser = async (req, res, next) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('userId', sql.Int, req.user.userId)
            .query(`
        SELECT UserID, Username, Email, FullName, PhoneNumber, UserRole, Avatar, CreatedDate, UpdatedDate
        FROM [User]
        WHERE UserID = @userId
      `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
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

// Forgot password (placeholder - requires email service)
exports.forgotPassword = async (req, res) => {
    res.status(501).json({
        success: false,
        message: 'Chức năng này chưa được triển khai. Vui lòng liên hệ admin.'
    });
};

// Reset password (placeholder)
exports.resetPassword = async (req, res) => {
    res.status(501).json({
        success: false,
        message: 'Chức năng này chưa được triển khai. Vui lòng liên hệ admin.'
    });
};