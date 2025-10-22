const sql = require('mssql');
const dbConfig = require('../config/database'); // Import config

// Hàm helper để tạo và đóng kết nối
const getDbConnection = async () => {
    try {
        const pool = await sql.connect(dbConfig);
        return pool;
    } catch (err) {
        console.error('Lỗi kết nối SQL Server:', err);
        throw new Error('Không thể kết nối đến cơ sở dữ liệu');
    }
};

exports.getStatistics = async (req, res) => {
    let pool;
    try {
        pool = await getDbConnection();

        // Định nghĩa 4 câu truy vấn SQL
        // Query 1: Lấy tổng doanh thu năm nay và tháng nay
        const totalsQuery = `
            SELECT
                ISNULL(SUM(CASE WHEN YEAR(OrderDate) = YEAR(GETDATE()) THEN TotalAmount ELSE 0 END), 0) AS totalRevenueCurrentYear,
                ISNULL(SUM(CASE WHEN YEAR(OrderDate) = YEAR(GETDATE()) AND MONTH(OrderDate) = MONTH(GETDATE()) THEN TotalAmount ELSE 0 END), 0) AS totalRevenueCurrentMonth
            FROM [dbo].[Order]
            WHERE OrderStatus = 'Completed' AND OrderDate IS NOT NULL;
        `;

        // Query 2: Doanh thu 30 ngày gần nhất (cho biểu đồ daily)
        // FORMAT(OrderDate, 'dd/MM') khớp với C# cũ và biểu đồ [cite: 20]
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

        // Query 3: Doanh thu 12 tháng gần nhất (cho biểu đồ monthly)
        // FORMAT(OrderDate, 'MMM yyyy', 'vi-VN') khớp C# cũ và biểu đồ [cite: 20]
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

        // Query 4: Doanh thu theo năm (cho biểu đồ yearly) [cite: 20]
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
        const totals = totalsResult.recordset[0] || { totalRevenueCurrentYear: 0, totalRevenueCurrentMonth: 0 };

        // Tạo đối tượng data để trả về
        // Cấu trúc này khớp với ApiHelper.cs và AccountController.cs
        const responseData = {
            totalRevenueCurrentYear: totals.totalRevenueCurrentYear,
            totalRevenueCurrentMonth: totals.totalRevenueCurrentMonth,
            dailyRevenueLast30Days: dailyResult.recordset,
            monthlyRevenue: monthlyResult.recordset,
            yearlyRevenue: yearlyResult.recordset
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
    } finally {
        if (pool) {
            pool.close(); // Đóng kết nối sau khi hoàn tất
        }
    }
};