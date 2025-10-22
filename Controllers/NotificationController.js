const { getPool, sql } = require('../config/database');

// Get notifications
exports.getNotifications = async (req, res, next) => {
    try {
        const { page = 1, limit = 20, isRead } = req.query;
        const offset = (page - 1) * limit;
        const userId = req.user.userId;

        const pool = await getPool();
        let whereClause = 'WHERE UserID = @userId';
        const request = pool.request()
            .input('userId', sql.Int, userId)
            .input('limit', sql.Int, parseInt(limit))
            .input('offset', sql.Int, offset);

        if (isRead !== undefined) {
            whereClause += ' AND IsRead = @isRead';
            request.input('isRead', sql.Bit, isRead === 'true' ? 1 : 0);
        }

        const result = await request.query(`
      SELECT 
        NotificationID, UserID, Message, CreatedDate, NotificationType, IsRead
      FROM [Notification]
      ${whereClause}
      ORDER BY CreatedDate DESC
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

        const countResult = await pool.request()
            .input('userId', sql.Int, userId)
            .input('isRead', sql.Bit, isRead === 'true' ? 1 : 0)
            .query(`SELECT COUNT(*) as total FROM [Notification] ${whereClause}`);

        const total = countResult.recordset[0].total;

        res.json({
            success: true,
            data: {
                notifications: result.recordset,
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

// Mark notification as read
exports.markAsRead = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;

        const pool = await getPool();

        // Check if notification belongs to user
        const checkResult = await pool.request()
            .input('notificationId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .query('SELECT NotificationID FROM [Notification] WHERE NotificationID = @notificationId AND UserID = @userId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy thông báo'
            });
        }

        await pool.request()
            .input('notificationId', sql.Int, id)
            .query('UPDATE [Notification] SET IsRead = 1 WHERE NotificationID = @notificationId');

        res.json({
            success: true,
            message: 'Đánh dấu đã đọc thành công'
        });
    } catch (error) {
        next(error);
    }
};

// Delete notification
exports.deleteNotification = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;

        const pool = await getPool();

        const result = await pool.request()
            .input('notificationId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .query('DELETE FROM [Notification] WHERE NotificationID = @notificationId AND UserID = @userId');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy thông báo'
            });
        }

        res.json({
            success: true,
            message: 'Xóa thông báo thành công'
        });
    } catch (error) {
        next(error);
    }
};

// Delete all notifications
exports.deleteAllNotifications = async (req, res, next) => {
    try {
        const userId = req.user.userId;

        const pool = await getPool();
        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .query('DELETE FROM [Notification] WHERE UserID = @userId');

        res.json({
            success: true,
            message: `Đã xóa ${result.rowsAffected[0]} thông báo`
        });
    } catch (error) {
        next(error);
    }
};

// Get unread count
exports.getUnreadCount = async (req, res, next) => {
    try {
        const userId = req.user.userId;

        const pool = await getPool();
        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .query('SELECT COUNT(*) as count FROM [Notification] WHERE UserID = @userId AND IsRead = 0');

        res.json({
            success: true,
            data: {
                unreadCount: result.recordset[0].count
            }
        });
    } catch (error) {
        next(error);
    }
};