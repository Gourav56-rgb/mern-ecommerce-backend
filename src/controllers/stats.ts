import { myCache } from "../app.js";
import { TryCatch } from "../middlewares/error.js";
import { Order } from "../models/order.js";
import { Product } from "../models/product.js";
import { User } from "../models/user.js";
import {
  calculatePercentage,
  getChartData,
  getInventories,
} from "../utils/features.js";

export const getDashboardStats = TryCatch(async (req, res, next) => {
  let stats = {};

  if (myCache.has("admin-stats")) {
    stats = JSON.parse(myCache.get("admin-stats") as string);
  } else {
    const today = new Date();

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const thisMonth = {
      start: new Date(today.getFullYear(), today.getMonth(), 1),
      end: today,
    };

    const lastMonth = {
      start: new Date(today.getFullYear(), today.getMonth() - 1, 1),
      end: new Date(today.getFullYear(), today.getMonth(), 0),
    };

    const thisMonthProductsPromise = Product.find({
      createdAt: { $gte: thisMonth.start, $lte: thisMonth.end },
    });

    const lastMonthProductsPromise = Product.find({
      createdAt: { $gte: lastMonth.start, $lte: lastMonth.end },
    });

    const thisMonthUsersPromise = User.find({
      createdAt: { $gte: thisMonth.start, $lte: thisMonth.end },
    });

    const lastMonthUsersPromise = User.find({
      createdAt: { $gte: lastMonth.start, $lte: lastMonth.end },
    });

    const thisMonthOrdersPromise = Order.find({
      createdAt: { $gte: thisMonth.start, $lte: thisMonth.end },
    });

    const lastMonthOrdersPromise = Order.find({
      createdAt: { $gte: lastMonth.start, $lte: lastMonth.end },
    });

    const lastSixMonthOrdersPromise = Order.find({
      createdAt: { $gte: sixMonthsAgo, $lte: today },
    });

    const latestTransactionsPromise = Order.find()
      .select(["orderItems", "discount", "total", "status"])
      .limit(4);

    const [
      thisMonthProducts,
      thisMonthUsers,
      thisMonthOrders,
      lastMonthProducts,
      lastMonthUsers,
      lastMonthOrders,
      productsCount,
      usersCount,
      allOrders,
      lastSixMonthOrders,
      categories,
      femaleUsersCount,
      latestTransactions,
    ] = await Promise.all([
      thisMonthProductsPromise,
      thisMonthUsersPromise,
      thisMonthOrdersPromise,
      lastMonthProductsPromise,
      lastMonthUsersPromise,
      lastMonthOrdersPromise,
      Product.countDocuments(),
      User.countDocuments(),
      Order.find().select("total"),
      lastSixMonthOrdersPromise,
      Product.distinct("category"),
      User.countDocuments({ gender: "female" }),
      latestTransactionsPromise,
    ]);

    const thisMonthRevenue = thisMonthOrders.reduce(
      (total, order) => total + (order.total || 0),
      0
    );

    const lastMonthRevenue = lastMonthOrders.reduce(
      (total, order) => total + (order.total || 0),
      0
    );

    const changePercent = {
      revenue: calculatePercentage(thisMonthRevenue, lastMonthRevenue),
      product: calculatePercentage(
        thisMonthProducts.length,
        lastMonthProducts.length
      ),
      user: calculatePercentage(thisMonthUsers.length, lastMonthUsers.length),
      order: calculatePercentage(
        thisMonthOrders.length,
        lastMonthOrders.length
      ),
    };

    const revenue = allOrders.reduce(
      (total, order) => total + (order.total || 0),
      0
    );

    const count = {
      revenue,
      product: productsCount,
      user: usersCount,
      order: allOrders.length,
    };

    const orderMonthCounts = new Array(6).fill(0);
    const orderMonthlyRevenue = new Array(6).fill(0);

    lastSixMonthOrders.forEach((order) => {
      const creationDate = order.createdAt;
      const monthDiff = (today.getMonth() - creationDate.getMonth() + 12) % 12;

      if (monthDiff < 6) {
        orderMonthCounts[6 - monthDiff - 1] += 1;
        orderMonthlyRevenue[6 - monthDiff - 1] = order.total;
      }
    });

    const categoryCount = await getInventories({ categories, productsCount });

    const userRatio = {
      male: usersCount - femaleUsersCount,
      female: femaleUsersCount,
    };

    const modifiedLatestTransaction = latestTransactions.map((i) => ({
      _id: i._id,
      discount: i.discount,
      amount: i.total,
      quantity: i.orderItems.length,
      status: i.status,
    }));

    stats = {
      categoryCount,
      changePercent,
      count,
      chart: {
        order: orderMonthCounts,             
        revenue: orderMonthlyRevenue,
      },
      userRatio,
      latestTransactions: modifiedLatestTransaction,
    };

    myCache.set("admin-stats", JSON.stringify(stats));
  }

  return res.status(200).json({
    success: true,
    stats,
  });
});

export const getPieCharts = TryCatch(async (req, res, next) => {
  let charts;

  if (myCache.has("admin-pie-charts")) {
    charts = JSON.parse(myCache.get("admin-pie-charts") as string);
  } else {
    const allOrderPromise = Order.find();
    const [
      processingOrder,
      shippedOrder,
      deliveredOrder,
      categories,
      productsCount,
      outOfStock,
      allOrders,
      allUsers,
      adminUsers,
      customerUsers,
    ] = await Promise.all([
      Order.countDocuments({ status: "Processing" }),
      Order.countDocuments({ status: "Shipped" }),
      Order.countDocuments({ status: "Delivered" }),
      Product.distinct("category"),
      Product.countDocuments(),
      Product.countDocuments({ stock: 0 }),
      allOrderPromise,
      User.find().select("dob"),
      User.countDocuments({ role: "admin" }),
      User.countDocuments({ role: "user" }),
    ]);

    const orderFulfillment = {
      processing: processingOrder,
      shipped: shippedOrder,
      delivered: deliveredOrder,
    };

    const productCategories = await getInventories({
      categories,
      productsCount,
    });

    const stockAvailability = {
      inStock: productsCount - outOfStock,
      outOfStock,
    };

    const grossIncome = allOrders.reduce(
      (prev, order) => prev + (order.total || 0),
      0
    );

    const discount = allOrders.reduce(
      (prev, order) => prev + (order.discount || 0),
      0
    );

    const productionCost = allOrders.reduce(
      (prev, order) => prev + (order.shippingCharges || 0),
      0
    );

    const burnt = allOrders.reduce((prev, order) => prev + (order.tax || 0), 0);

    const marketingCost = Math.round(grossIncome * (50 / 100));

    const netMargin =
      grossIncome - discount - productionCost - burnt - marketingCost;

    const revenueDistribution = {
      netMargin,
      discount,
      productionCost,
      burnt,
      marketingCost,
    };

    const usersAgeGroup = {
      teen: allUsers.filter((i) => i.age < 20).length,
      adult: allUsers.filter((i) => i.age >= 20 && i.age < 40).length,
      old: allUsers.filter((i) => i.age >= 40).length,
    };

    const adminCustomer = {
      admin: adminUsers,
      user: customerUsers,
    };

    charts = {
      orderFulfillment,
      productCategories,
      stockAvailability,
      revenueDistribution,
      usersAgeGroup,
      adminCustomer,
    };

    myCache.set("admin-pie-charts", JSON.stringify(charts));
  }

  return res.status(200).json({
    success: true,
    charts,
  });
});

export const getBarCharts = TryCatch(async (req, res, next) => {
  let charts;

  if (myCache.has("admin-bar-charts")) {
    charts = JSON.parse(myCache.get("admin-bar-charts") as string);
  } else {
    const today = new Date();

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const sixMonthProductsPromise = Product.find({
      createdAt: { $gte: sixMonthsAgo, $lte: today },
    });

    const sixMonthUsersPromise = User.find({
      createdAt: { $gte: sixMonthsAgo, $lte: today },
    });

    const twelveMonthOrdersPromise = Order.find({
      createdAt: { $gte: twelveMonthsAgo, $lte: today },
    });

    const [products, users, orders] = await Promise.all([
      sixMonthProductsPromise,
      sixMonthUsersPromise,
      twelveMonthOrdersPromise,
    ]);

    const productsCounts = getChartData({ length: 6, today, docArr: products });

    const usersCounts = getChartData({ length: 6, today, docArr: users });

    const ordersCounts = getChartData({ length: 12, today, docArr: orders });

    charts = {
      products: productsCounts,
      users: usersCounts,
      orders: ordersCounts
    };

    myCache.set("admin-bar-charts", JSON.stringify(charts));
  }

  return res.status(200).json({
    success: true,
    charts,
  });
});

export const getLineCharts = TryCatch(async (req, res, next) => {
  let charts;

  if (myCache.has("admin-line-charts")) {
    charts = JSON.parse(myCache.get("admin-line-charts") as string);
  } else {
    const today = new Date();

    const twelveMonthsAgo = new Date();

    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const baseQuery = {
      createdAt: { $gte: twelveMonthsAgo, $lte: today },
    }

    const [products, users, orders] = await Promise.all([
      Product.find(baseQuery).select("createdAt"),
      User.find(baseQuery).select("createdAt"),
      Order.find(baseQuery).select(["createdAt", "discount", "total"]),
    ]);

    const productsCounts = getChartData({ length: 12, today, docArr: products });

    const usersCounts = getChartData({ length: 12, today, docArr: users });

    const discount = getChartData({ length: 12, today, docArr: orders, property: "discount" })

    const revenue = getChartData({ length: 12, today, docArr: orders, property: "total" })

    charts = {
      products: productsCounts,
      users: usersCounts,
      discount,
      revenue
    };

    myCache.set("admin-line-charts", JSON.stringify(charts));
  }

  return res.status(200).json({
    success: true,
    charts,
  });
});
