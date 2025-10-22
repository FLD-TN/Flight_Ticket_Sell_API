const bcrypt = require('bcrypt');
const { getPool, sql } = require('../config/database');
const Joi = require('joi');
const fs = require('fs');
const path = require('path');

// Validation schemas
const updateUserSchema = Joi.object({
    fullName: Joi.string().min(2).max(100).optional(),
    username: Joi.string().alphanum().min(3).max(50).optional(),
    email: Joi.string().email().optional(),
    phoneNumber: Joi.string().pattern(/^[0-9]{10,15}$/).optional().allow('', null)
});

const changePasswordSchema = Joi.object({
    oldPassword: Joi.string().required(),
    newPassword: Joi.string().min(6).max(100).required(),
    confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required()
});

// Get all users (Admin only)
exports.getAllUsers = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, search = '', role = '' } = req.query;
        const offset = (page - 1) * limit;

        const pool = await getPool();

        let whereClause = 'WHERE 1=1';
        const request = pool.request()
            .input('limit', sql.Int, parseInt(limit))
            .input('offset', sql.Int, offset);

        if (search) {
            whereClause += ` AND (Username LIKE @search OR Email LIKE @search OR FullName LIKE @search)`;
            request.input('search', sql.NVarChar, `%${search}%`);
        }

        if (role) {
            whereClause += ` AND UserRole = @role`;
            request.input('role', sql.NVarChar, role);
        }

        const result = await request.query(`
      SELECT UserID, Username, FullName, Email, PhoneNumber, UserRole, Avatar, CreatedDate, UpdatedDate
      FROM [User]
      ${whereClause}
      ORDER BY CreatedDate DESC
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

        const countResult = await pool.request()
            .input('search', sql.NVarChar, search ? `%${search}%` : '')
            .input('role', sql.NVarChar, role)
            .query(`
        SELECT COUNT(*) as total FROM [User]
        ${whereClause.replace(/@limit|@offset/g, '')}
      `);

        const total = countResult.recordset[0].total;

        res.json({
            success: true,
            data: {
                users: result.recordset,
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

// Get user by ID
exports.getUserById = async (req, res, next) => {
    try {
        const { id } = req.params;

        // Check authorization
        if (req.user.userId !== parseInt(id) && req.user.role !== 'Admin') {
            return res.status(403).json({
                success: false,
                message: 'Bạn không có quyền truy cập thông tin này'
            });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input('userId', sql.Int, id)
            .query(`
        SELECT UserID, Username, FullName, Email, PhoneNumber, UserRole, Avatar, CreatedDate, UpdatedDate
        FROM [User]
        WHERE UserID = @userId
      `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng'
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

// Update user
exports.updateUser = async (req, res, next) => {
    try {
        const { id } = req.params;

        // Check authorization
        if (req.user.userId !== parseInt(id) && req.user.role !== 'Admin') {
            return res.status(403).json({
                success: false,
                message: 'Bạn không có quyền cập nhật thông tin này'
            });
        }

        const { error, value } = updateUserSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const pool = await getPool();

        // Check if username or email already exists
        if (value.username || value.email) {
            const checkResult = await pool.request()
                .input('userId', sql.Int, id)
                .input('username', sql.NVarChar, value.username || '')
                .input('email', sql.NVarChar, value.email || '')
                .query(`
          SELECT UserID FROM [User]
          WHERE UserID != @userId AND (Username = @username OR Email = @email)
        `);

            if (checkResult.recordset.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Username hoặc Email đã tồn tại'
                });
            }
        }

        const updateFields = [];
        const request = pool.request().input('userId', sql.Int, id);

        if (value.fullName) {
            updateFields.push('FullName = @fullName');
            request.input('fullName', sql.NVarChar, value.fullName);
        }
        if (value.username) {
            updateFields.push('Username = @username');
            request.input('username', sql.NVarChar, value.username);
        }
        if (value.email) {
            updateFields.push('Email = @email');
            request.input('email', sql.NVarChar, value.email);
        }
        if (value.phoneNumber !== undefined) {
            updateFields.push('PhoneNumber = @phoneNumber');
            request.input('phoneNumber', sql.NVarChar, value.phoneNumber);
        }

        updateFields.push('UpdatedDate = GETDATE()');

        const result = await request.query(`
      UPDATE [User]
      SET ${updateFields.join(', ')}
      OUTPUT INSERTED.UserID, INSERTED.Username, INSERTED.FullName, INSERTED.Email, INSERTED.PhoneNumber, INSERTED.UserRole, INSERTED.Avatar
      WHERE UserID = @userId
    `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng'
            });
        }

        res.json({
            success: true,
            message: 'Cập nhật thông tin thành công',
            data: result.recordset[0]
        });
    } catch (error) {
        next(error);
    }
};

// Delete user
exports.deleteUser = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { password } = req.body;

        // Check authorization
        if (req.user.userId !== parseInt(id) && req.user.role !== 'Admin') {
            return res.status(403).json({
                success: false,
                message: 'Bạn không có quyền xóa tài khoản này'
            });
        }

        if (!password) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng nhập mật khẩu để xác nhận'
            });
        }

        const pool = await getPool();

        // Verify password
        const userResult = await pool.request()
            .input('userId', sql.Int, id)
            .query('SELECT Password FROM [User] WHERE UserID = @userId');

        if (userResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Tài khoản không tồn tại'
            });
        }

        const isPasswordValid = await bcrypt.compare(password, userResult.recordset[0].Password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Mật khẩu không chính xác'
            });
        }

        // Begin transaction
        const transaction = pool.transaction();
        await transaction.begin();

        try {
            // Delete related records
            await transaction.request()
                .input('userId', sql.Int, id)
                .query('DELETE FROM [Notification] WHERE UserID = @userId');

            await transaction.request()
                .input('userId', sql.Int, id)
                .query(`
          DELETE FROM [OrderDetail]
          WHERE OrderID IN (SELECT OrderID FROM [Order] WHERE UserID = @userId)
        `);

            await transaction.request()
                .input('userId', sql.Int, id)
                .query('DELETE FROM [Order] WHERE UserID = @userId');

            await transaction.request()
                .input('userId', sql.Int, id)
                .query('DELETE FROM [Ticket] WHERE UserID = @userId');

            await transaction.request()
                .input('userId', sql.Int, id)
                .query('DELETE FROM [Feedback] WHERE UserID = @userId');

            await transaction.request()
                .input('userId', sql.Int, id)
                .query('DELETE FROM [User] WHERE UserID = @userId');

            await transaction.commit();

            res.json({
                success: true,
                message: 'Xóa tài khoản thành công'
            });
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    } catch (error) {
        next(error);
    }
};

// Change password
exports.changePassword = async (req, res, next) => {
    try {
        const { id } = req.params;

        // Check authorization
        if (req.user.userId !== parseInt(id)) {
            return res.status(403).json({
                success: false,
                message: 'Bạn không có quyền thay đổi mật khẩu này'
            });
        }

        const { error, value } = changePasswordSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { oldPassword, newPassword } = value;

        const pool = await getPool();

        // Get current password
        const result = await pool.request()
            .input('userId', sql.Int, id)
            .query('SELECT Password FROM [User] WHERE UserID = @userId');

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng'
            });
        }

        // Verify old password
        const isPasswordValid = await bcrypt.compare(oldPassword, result.recordset[0].Password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Mật khẩu cũ không chính xác'
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        await pool.request()
            .input('userId', sql.Int, id)
            .input('password', sql.NVarChar, hashedPassword)
            .query(`
        UPDATE [User]
        SET Password = @password, UpdatedDate = GETDATE()
        WHERE UserID = @userId
      `);

        res.json({
            success: true,
            message: 'Đổi mật khẩu thành công'
        });
    } catch (error) {
        next(error);
    }
};

// Upload avatar
exports.uploadAvatar = async (req, res, next) => {
    try {
        const { id } = req.params;

        // Check authorization
        if (req.user.userId !== parseInt(id) && req.user.role !== 'Admin') {
            return res.status(403).json({
                success: false,
                message: 'Bạn không có quyền cập nhật ảnh đại diện này'
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng chọn một ảnh hợp lệ'
            });
        }

        const avatarPath = `/uploads/avatars/${req.file.filename}`;

        const pool = await getPool();

        // Get old avatar to delete
        const oldAvatarResult = await pool.request()
            .input('userId', sql.Int, id)
            .query('SELECT Avatar FROM [User] WHERE UserID = @userId');

        // Update avatar in database
        const result = await pool.request()
            .input('userId', sql.Int, id)
            .input('avatar', sql.NVarChar, avatarPath)
            .query(`
        UPDATE [User]
        SET Avatar = @avatar, UpdatedDate = GETDATE()
        OUTPUT INSERTED.Avatar
        WHERE UserID = @userId
      `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng'
            });
        }

        // Delete old avatar file if not default
        if (oldAvatarResult.recordset.length > 0) {
            const oldAvatar = oldAvatarResult.recordset[0].Avatar;
            if (oldAvatar && !oldAvatar.includes('default.png')) {
                const oldPath = path.join(__dirname, '..', oldAvatar);
                if (fs.existsSync(oldPath)) {
                    fs.unlinkSync(oldPath);
                }
            }
        }

        res.json({
            success: true,
            message: 'Cập nhật ảnh đại diện thành công',
            data: {
                avatar: avatarPath
            }
        });
    } catch (error) {
        next(error);
    }
};

// Create user (Admin only)
exports.createUser = async (req, res, next) => {
    try {
        const { fullName, username, email, password, phoneNumber, userRole } = req.body;

        const pool = await getPool();

        // Check if user exists
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

        // Insert user
        const result = await pool.request()
            .input('fullName', sql.NVarChar, fullName)
            .input('username', sql.NVarChar, username)
            .input('email', sql.NVarChar, email)
            .input('password', sql.NVarChar, hashedPassword)
            .input('phoneNumber', sql.NVarChar, phoneNumber || null)
            .input('userRole', sql.NVarChar, userRole || 'User')
            .input('avatar', sql.NVarChar, '/Images/Avatars/default.png')
            .query(`
        INSERT INTO [User] (FullName, Username, Email, Password, PhoneNumber, UserRole, Avatar, CreatedDate)
        OUTPUT INSERTED.UserID, INSERTED.Username, INSERTED.Email, INSERTED.FullName, INSERTED.UserRole
        VALUES (@fullName, @username, @email, @password, @phoneNumber, @userRole, @avatar, GETDATE())
      `);

        res.status(201).json({
            success: true,
            message: 'Tạo người dùng thành công',
            data: result.recordset[0]
        });
    } catch (error) {
        next(error);
    }
};