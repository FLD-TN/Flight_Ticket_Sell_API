const { getPool, sql } = require('../config/database');
const Joi = require('joi');

// Validation schema
const feedbackSchema = Joi.object({
    content: Joi.string().min(10).max(1000).required()
});

// Create feedback
exports.createFeedback = async (req, res, next) => {
    try {
        const { error, value } = feedbackSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { content } = value;
        const userId = req.user.userId;

        const pool = await getPool();
        const result = await pool.request()
            .input('content', sql.NVarChar, content)
            .input('userId', sql.Int, userId)
            .input('createdAt', sql.DateTime, new Date())
            .query(`
        INSERT INTO [Feedback] (Content, UserID, CreatedAt)
        OUTPUT INSERTED.*
        VALUES (@content, @userId, @createdAt)
      `);

        res.status(201).json({
            success: true,
            message: 'Gửi đánh giá thành công',
            data: result.recordset[0]
        });
    } catch (error) {
        next(error);
    }
};

// Get all feedbacks
exports.getFeedbacks = async (req, res, next) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const pool = await getPool();
        const result = await pool.request()
            .input('limit', sql.Int, parseInt(limit))
            .input('offset', sql.Int, offset)
            .query(`
        SELECT 
          f.Id, f.Content, f.CreatedAt, f.UserID,
          u.Username, u.FullName, u.Avatar
        FROM [Feedback] f
        INNER JOIN [User] u ON f.UserID = u.UserID
        ORDER BY f.CreatedAt DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);

        const countResult = await pool.request()
            .query('SELECT COUNT(*) as total FROM [Feedback]');

        const total = countResult.recordset[0].total;

        res.json({
            success: true,
            data: {
                feedbacks: result.recordset,
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

// Get feedback by ID
exports.getFeedbackById = async (req, res, next) => {
    try {
        const { id } = req.params;

        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, id)
            .query(`
        SELECT 
          f.Id, f.Content, f.CreatedAt, f.UserID,
          u.Username, u.FullName, u.Avatar
        FROM [Feedback] f
        INNER JOIN [User] u ON f.UserID = u.UserID
        WHERE f.Id = @id
      `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy đánh giá'
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

// Delete feedback (Admin only)
exports.deleteFeedback = async (req, res, next) => {
    try {
        const { id } = req.params;

        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM [Feedback] WHERE Id = @id');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy đánh giá'
            });
        }

        res.json({
            success: true,
            message: 'Xóa đánh giá thành công'
        });
    } catch (error) {
        next(error);
    }
};