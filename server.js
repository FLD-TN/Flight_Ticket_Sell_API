require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const { connectDB } = require('./config/database');
const errorHandler = require('./MiddleWares/errorHandler');

// Import routes
const authRoutes = require('./routes/AuthRoutes');
const userRoutes = require('./routes/UserRoutes');
const flightRoutes = require('./routes/FlightRoutes');
const ticketRoutes = require('./routes/TicketRoutes');
const orderRoutes = require('./routes/OrderRoutes');
const paymentRoutes = require('./routes/PaymentRoutes');
const feedbackRoutes = require('./routes/FeedbackRoutes');
const notificationRoutes = require('./routes/NotificationRoutes');
const statisticsRoutes = require('./routes/statisticsRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Security Middleware
app.use(helmet());
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Compression middleware
app.use(compression());

// Logging middleware
if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
} else {
    app.use(morgan('combined'));
}

// Static files
app.use('/uploads', express.static('uploads'));

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// API Routes
const API_PREFIX = process.env.API_PREFIX || '/api';
const API_VERSION = process.env.API_VERSION || 'v1';

app.use(`${API_PREFIX}/${API_VERSION}/auth`, authRoutes);
app.use(`${API_PREFIX}/${API_VERSION}/users`, userRoutes);
app.use(`${API_PREFIX}/${API_VERSION}/flights`, flightRoutes);
app.use(`${API_PREFIX}/${API_VERSION}/tickets`, ticketRoutes);
app.use(`${API_PREFIX}/${API_VERSION}/orders`, orderRoutes);
app.use(`${API_PREFIX}/${API_VERSION}/payment`, paymentRoutes);
app.use(`${API_PREFIX}/${API_VERSION}/feedbacks`, feedbackRoutes);
app.use(`${API_PREFIX}/${API_VERSION}/notifications`, notificationRoutes);
app.use(`${API_PREFIX}/${API_VERSION}/statistics`, statisticsRoutes);


// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// Error handling middleware
app.use(errorHandler);

// Connect to database and start server
connectDB()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`✅ Server is running on port ${PORT}`);
            console.log(`✅ Environment: ${process.env.NODE_ENV}`);
            console.log(`✅ API URL: http://localhost:${PORT}${API_PREFIX}/${API_VERSION}`);
        });
    })
    .catch((error) => {
        console.error('❌ Failed to connect to database:', error);
        process.exit(1);
    });

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    console.error('❌ Unhandled Rejection:', err);
    process.exit(1);
});

module.exports = app;