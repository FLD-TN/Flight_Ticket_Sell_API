const errorHandler = (err, req, res, next) => {
    console.error('Error:', err);

    // Joi validation error
    if (err.isJoi) {
        return res.status(400).json({
            success: false,
            message: 'Validation error',
            errors: err.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message
            }))
        });
    }

    // SQL error
    if (err.name === 'ConnectionError' || err.name === 'RequestError') {
        return res.status(500).json({
            success: false,
            message: 'Database error occurred',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }

    // JWT error
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
            success: false,
            message: 'Invalid token'
        });
    }

    // Multer error (file upload)
    if (err.name === 'MulterError') {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'File too large. Maximum size is 5MB.'
            });
        }
        return res.status(400).json({
            success: false,
            message: 'File upload error',
            error: err.message
        });
    }

    // Default error
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal server error';

    res.status(statusCode).json({
        success: false,
        message,
        error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
};

module.exports = errorHandler;