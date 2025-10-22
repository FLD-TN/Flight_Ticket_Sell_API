const jwt = require('jsonwebtoken');
const { getPool } = require('../config/database');

// Verify JWT token
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'Access denied. No token provided.'
            });
        }

        const token = authHeader.substring(7);

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // Verify user still exists
            const pool = await getPool();
            const result = await pool.request()
                .input('userId', decoded.userId)
                .query('SELECT UserID, Username, Email, UserRole FROM [User] WHERE UserID = @userId');

            if (result.recordset.length === 0) {
                return res.status(401).json({
                    success: false,
                    message: 'User not found.'
                });
            }

            req.user = {
                userId: decoded.userId,
                username: decoded.username,
                email: decoded.email,
                role: decoded.role
            };

            next();
        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                return res.status(401).json({
                    success: false,
                    message: 'Token expired.'
                });
            }

            return res.status(401).json({
                success: false,
                message: 'Invalid token.'
            });
        }
    } catch (error) {
        console.error('Authentication error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error during authentication.'
        });
    }
};

// Check if user is admin
const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'Admin') {
        next();
    } else {
        res.status(403).json({
            success: false,
            message: 'Access denied. Admin privileges required.'
        });
    }
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return next();
        }

        const token = authHeader.substring(7);

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = {
                userId: decoded.userId,
                username: decoded.username,
                email: decoded.email,
                role: decoded.role
            };
        } catch (error) {
            // Token invalid but continue anyway
        }

        next();
    } catch (error) {
        next();
    }
};

module.exports = {
    authenticate,
    isAdmin,
    optionalAuth
};