const { getPool, sql } = require('../config/database');


exports.getStatistics = async (req, res) => {
    try {
        const pool = await getPool();

        const totalsQuery = `
            SELECT
                ISNULL(SUM(CASE WHEN YEAR(OrderDate) = YEAR(GETDATE()) THEN TotalAmount ELSE 0 END), 0) AS totalRevenueCurrentYear,
                ISNULL(SUM(CASE WHEN YEAR(OrderDate) = YEAR(GETDATE()) AND MONTH(OrderDate) = MONTH(GETDATE()) THEN TotalAmount ELSE 0 END), 0) AS totalRevenueCurrentMonth
            FROM [dbo].[Order]
            WHERE OrderStatus = 'Completed' AND OrderDate IS NOT NULL;
        `;

        // Query 2: Doanh thu 30 ngày gần nhất
        const dailyRevenueQuery = `
            SELECT
                FORMAT(OrderDate, 'dd/MM') AS label,
                SUM(TotalAmount) AS value
            FROM [dbo].[Order]
            WHERE
                OrderStatus = 'Completed'
                AND OrderDate >= DATEADD(day, -30, CAST(GETDATE() AS DATE))
            GROUP BY
                CAST(OrderDate AS DATE), FORMAT(OrderDate, 'dd/MM')
            ORDER BY
                CAST(OrderDate AS DATE);
        `;

        // Query 3: Doanh thu 12 tháng gần nhất
        const monthlyRevenueQuery = `
            SELECT
                FORMAT(OrderDate, 'MMM yyyy', 'vi-VN') AS label,
                SUM(TotalAmount) AS value
            FROM [dbo].[Order]
            WHERE
                OrderStatus = 'Completed'
                AND OrderDate >= DATEADD(month, -11, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
            GROUP BY
                YEAR(OrderDate), MONTH(OrderDate), FORMAT(OrderDate, 'MMM yyyy', 'vi-VN')
            ORDER BY
                YEAR(OrderDate), MONTH(OrderDate);
        `;

        // Query 4: Doanh thu theo năm
        const yearlyRevenueQuery = `
            SELECT
                CAST(YEAR(OrderDate) AS VARCHAR) AS label,
                SUM(TotalAmount) AS value
            FROM [dbo].[Order]
            WHERE
                OrderStatus = 'Completed' AND OrderDate IS NOT NULL
            GROUP BY
                YEAR(OrderDate)
            ORDER BY
                label;
        `;

        // Thực thi song song 4 truy vấn
        const [
            totalsResult,
            dailyResult,
            monthlyResult,
            yearlyResult
        ] = await Promise.all([
            pool.request().query(totalsQuery),
            pool.request().query(dailyRevenueQuery),
            pool.request().query(monthlyRevenueQuery),
            pool.request().query(yearlyRevenueQuery)
        ]);

        // Trích xuất kết quả
        const totals = totalsResult.recordset[0] || {
            totalRevenueCurrentYear: 0,
            totalRevenueCurrentMonth: 0
        };

        // Tạo response data
        const MULTIPLIER = 10000;

        const responseData = {
            totalRevenueCurrentYear: totals.totalRevenueCurrentYear * MULTIPLIER,
            totalRevenueCurrentMonth: totals.totalRevenueCurrentMonth * MULTIPLIER,
            dailyRevenueLast30Days: dailyResult.recordset.map(item => ({
                label: item.label,
                value: item.value * MULTIPLIER
            })),
            monthlyRevenue: monthlyResult.recordset.map(item => ({
                label: item.label,
                value: item.value * MULTIPLIER
            })),
            yearlyRevenue: yearlyResult.recordset.map(item => ({
                label: item.label,
                value: item.value * MULTIPLIER
            }))
        };

        res.status(200).json({
            success: true,
            message: "Lấy dữ liệu thống kê thành công",
            data: responseData
        });

    } catch (err) {
        console.error('Lỗi khi lấy thống kê:', err);
        res.status(500).json({
            success: false,
            message: `Lỗi server: ${err.message}`
        });
    }
    // ❌ XÓA phần finally - KHÔNG đóng pool
    // Connection pool sẽ tự động quản lý
};