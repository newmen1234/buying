// RetailCRM API Service
// API Documentation: https://help.retailcrm.pro/Developers/ApiVersion5

const API_VERSION = "v5";

interface RetailcrmConfig {
  subdomain: string;
  apiKey: string;
}

function getBaseUrl(subdomain: string): string {
  return `https://${subdomain}.retailcrm.ru/api/${API_VERSION}`;
}

async function retailcrmRequest(
  config: RetailcrmConfig,
  endpoint: string,
  method: "GET" | "POST" = "GET",
  params: Record<string, any> = {}
): Promise<any> {
  const baseUrl = getBaseUrl(config.subdomain);
  const url = new URL(`${baseUrl}${endpoint}`);
  
  // Add API key to all requests
  url.searchParams.set("apiKey", config.apiKey);
  
  // Add other params for GET requests
  if (method === "GET") {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        // Use append for array-style parameters (filter[xxx][])
        url.searchParams.append(key, String(value));
      }
    });
  }
  
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };
  
  // For POST requests, send params in body
  if (method === "POST" && Object.keys(params).length > 0) {
    const formData = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
      }
    });
    options.body = formData.toString();
  }
  
  const response = await fetch(url.toString(), options);
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`RetailCRM API error: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(`RetailCRM API error: ${data.errorMsg || "Unknown error"}`);
  }
  
  return data;
}

// Verify API connection
export async function verifyConnection(config: RetailcrmConfig): Promise<{ success: boolean; error?: string }> {
  try {
    // Use /reference/sites endpoint to verify connection - simple lightweight call
    const data = await retailcrmRequest(config, "/reference/sites");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Get API credentials info
export async function getCredentials(config: RetailcrmConfig): Promise<any> {
  return retailcrmRequest(config, "/credentials");
}

// Fetch users (managers) list with pagination
export async function getUsers(config: RetailcrmConfig): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const data = await retailcrmRequest(config, "/users", "GET", { limit: "100", page: String(page) });
    if (data.users) {
      for (const u of data.users) {
        if (u.id) {
          const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || `#${u.id}`;
          map[String(u.id)] = name;
        }
      }
    }
    if (data.pagination?.totalPageCount) {
      totalPages = data.pagination.totalPageCount;
    }
    page++;
  }
  return map;
}

// Orders API - fetch single page
export async function fetchOrdersPagePublic(
  config: RetailcrmConfig,
  filter: { statusUpdatedAtFrom?: string; statusUpdatedAtTo?: string } = {},
  page: number = 1,
  limit: number = 100
): Promise<any> {
  return fetchOrdersPage(config, filter, page, limit);
}

async function fetchOrdersPage(
  config: RetailcrmConfig,
  filter: { statusUpdatedAtFrom?: string; statusUpdatedAtTo?: string } = {},
  page: number = 1,
  limit: number = 100
): Promise<any> {
  const baseUrl = getBaseUrl(config.subdomain);
  const url = new URL(`${baseUrl}/orders`);
  
  url.searchParams.set("apiKey", config.apiKey);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));
  
  // Add date filters by status change date
  if (filter.statusUpdatedAtFrom) {
    url.searchParams.set("filter[statusUpdatedAtFrom]", filter.statusUpdatedAtFrom);
  }
  if (filter.statusUpdatedAtTo) {
    url.searchParams.set("filter[statusUpdatedAtTo]", filter.statusUpdatedAtTo);
  }
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`RetailCRM API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(`RetailCRM API error: ${data.errorMsg || "Unknown error"}`);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

// Orders API - fetch all pages and filter by status
export async function getOrders(
  config: RetailcrmConfig,
  filter: { statuses?: string[]; statusUpdatedAtFrom?: string; statusUpdatedAtTo?: string } = {},
  page: number = 1,
  limit: number = 100
): Promise<any> {
  // If no status filter, just fetch single page
  if (!filter.statuses || filter.statuses.length === 0) {
    console.log("RetailCRM: No status filter, fetching single page");
    return fetchOrdersPage(config, filter, page, limit);
  }
  
  // With status filter - need to fetch ALL pages and filter server-side
  // because RetailCRM API filter[statuses][] doesn't work on this account
  console.log("RetailCRM: Status filter active, fetching all pages...");
  
  const allOrders: any[] = [];
  let currentPage = 1;
  let totalPages = 1;
  const pageLimit = 100; // Max per page
  
  do {
    console.log(`RetailCRM: Fetching page ${currentPage}/${totalPages}...`);
    const pageData = await fetchOrdersPage(config, {
      statusUpdatedAtFrom: filter.statusUpdatedAtFrom,
      statusUpdatedAtTo: filter.statusUpdatedAtTo,
    }, currentPage, pageLimit);
    
    if (pageData.orders) {
      allOrders.push(...pageData.orders);
    }
    
    totalPages = pageData.pagination?.totalPageCount || 1;
    currentPage++;
    
    // Safety limit to prevent infinite loops
    if (currentPage > 500) break;
  } while (currentPage <= totalPages);
  
  console.log(`RetailCRM: Fetched ${allOrders.length} total orders from ${totalPages} pages`);
  
  // Filter by status
  const filteredOrders = allOrders.filter((order: any) => 
    filter.statuses!.includes(order.status)
  );
  
  console.log(`RetailCRM: After status filter: ${filteredOrders.length} orders`);
  
  // Return paginated result
  const startIndex = (page - 1) * limit;
  const paginatedOrders = filteredOrders.slice(startIndex, startIndex + limit);
  
  return {
    success: true,
    orders: paginatedOrders,
    pagination: {
      limit,
      currentPage: page,
      totalCount: filteredOrders.length,
      totalPageCount: Math.ceil(filteredOrders.length / limit),
    },
  };
}

export async function getOrder(
  config: RetailcrmConfig,
  externalId: string,
  site?: string
): Promise<any> {
  const params: Record<string, any> = {};
  if (site) params.site = site;
  return retailcrmRequest(config, `/orders/${externalId}`, "GET", params);
}

export async function editOrderCustomFields(
  config: RetailcrmConfig,
  orderId: number,
  customFields: Record<string, string | null>,
  site?: string
): Promise<any> {
  const orderPayload: any = { customFields };
  const params: Record<string, any> = {
    by: "id",
    order: JSON.stringify(orderPayload),
  };
  if (site) params.site = site;
  return retailcrmRequest(config, `/orders/${orderId}/edit`, "POST", params);
}

export async function editOrderStatus(
  config: RetailcrmConfig,
  orderId: number,
  status: string,
  site?: string
): Promise<any> {
  const orderPayload: any = { status };
  const params: Record<string, any> = {
    by: "id",
    order: JSON.stringify(orderPayload),
  };
  if (site) params.site = site;
  return retailcrmRequest(config, `/orders/${orderId}/edit`, "POST", params);
}

export async function getOrdersHistory(
  config: RetailcrmConfig,
  sinceId?: number,
  limit: number = 100
): Promise<any> {
  const params: Record<string, any> = { limit };
  if (sinceId) params["filter[sinceId]"] = sinceId;
  return retailcrmRequest(config, "/orders/history", "GET", params);
}

export async function getOrdersHistoryByDate(
  config: RetailcrmConfig,
  startDate: string,
  endDate?: string,
  page: number = 1,
  limit: number = 100,
): Promise<any> {
  const params: Record<string, any> = { limit, page, "filter[startDate]": startDate };
  if (endDate) params["filter[endDate]"] = endDate;
  return retailcrmRequest(config, "/orders/history", "GET", params);
}

export async function getOrdersHistorySinceId(
  config: RetailcrmConfig,
  sinceId: number,
  limit: number = 100,
): Promise<any> {
  const params: Record<string, any> = { limit, "filter[sinceId]": sinceId };
  return retailcrmRequest(config, "/orders/history", "GET", params);
}

export async function getOrderHistoryById(
  config: RetailcrmConfig,
  orderId: number,
  limit: number = 100,
  page: number = 1,
): Promise<any> {
  const params: Record<string, any> = { limit, page, "filter[orderId]": orderId };
  return retailcrmRequest(config, "/orders/history", "GET", params);
}

export async function findDeliveryDateFromHistory(
  config: RetailcrmConfig,
  orderId: number,
  targetStatuses: string[],
): Promise<{ date: string; status: string } | null> {
  const targetSet = new Set(targetStatuses);
  let page = 1;
  while (page <= 10) {
    const resp = await getOrderHistoryById(config, orderId, 100, page);
    if (!resp.history || resp.history.length === 0) break;
    for (const entry of resp.history) {
      if (entry.field === "status" && targetSet.has(entry.newValue?.code)) {
        return { date: entry.createdAt, status: entry.newValue.code };
      }
    }
    if (!resp.pagination || page >= resp.pagination.totalPageCount) break;
    page++;
  }
  return null;
}

export async function batchFindDeliveryDates(
  config: RetailcrmConfig,
  orderIds: number[],
  targetStatuses: string[],
  concurrency: number = 3,
): Promise<Map<number, { date: string; status: string }>> {
  const results = new Map<number, { date: string; status: string }>();
  for (let i = 0; i < orderIds.length; i += concurrency) {
    const batch = orderIds.slice(i, i + concurrency);
    const promises = batch.map(async (id) => {
      try {
        const result = await findDeliveryDateFromHistory(config, id, targetStatuses);
        if (result) results.set(id, result);
      } catch (err) {
        console.error(`Failed to fetch history for order ${id}:`, err);
      }
    });
    await Promise.all(promises);
    if (i + concurrency < orderIds.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }
  return results;
}

export async function getOrdersByIds(
  config: RetailcrmConfig,
  ids: number[],
): Promise<any[]> {
  if (ids.length === 0) return [];
  const baseUrl = getBaseUrl(config.subdomain);
  const allOrders: any[] = [];
  const BATCH = 20;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const url = new URL(`${baseUrl}/orders`);
    url.searchParams.set("apiKey", config.apiKey);
    url.searchParams.set("limit", "100");
    for (const id of batch) {
      url.searchParams.append("filter[ids][]", String(id));
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const resp = await fetch(url.toString(), { signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        console.warn(`getOrdersByIds batch ${i}-${i+batch.length}: HTTP ${resp.status} ${errText.substring(0, 200)}`);
        if (errText.includes("limit")) {
          const retryUrl = new URL(`${baseUrl}/orders`);
          retryUrl.searchParams.set("apiKey", config.apiKey);
          retryUrl.searchParams.set("limit", "20");
          for (const id of batch) retryUrl.searchParams.append("filter[ids][]", String(id));
          const retryResp = await fetch(retryUrl.toString());
          if (retryResp.ok) {
            const retryData = await retryResp.json();
            if (retryData.orders) allOrders.push(...Object.values(retryData.orders));
          }
        }
        continue;
      }
      const data = await resp.json();
      if (data.orders) allOrders.push(...Object.values(data.orders));
    } catch (err: any) {
      clearTimeout(timeout);
      console.warn(`getOrdersByIds batch ${i}-${i+batch.length}: ${err.name === 'AbortError' ? 'timeout' : err.message}`);
    }
    if (i + BATCH < ids.length) await new Promise(r => setTimeout(r, 250));
  }
  return allOrders;
}

// Customers API
export async function getCustomers(
  config: RetailcrmConfig,
  filter: Record<string, any> = {},
  page: number = 1,
  limit: number = 20
): Promise<any> {
  return retailcrmRequest(config, "/customers", "GET", {
    ...filter,
    page,
    limit,
  });
}

export async function getCustomer(
  config: RetailcrmConfig,
  externalId: string,
  site?: string
): Promise<any> {
  const params: Record<string, any> = {};
  if (site) params.site = site;
  return retailcrmRequest(config, `/customers/${externalId}`, "GET", params);
}

export async function getCustomersHistory(
  config: RetailcrmConfig,
  sinceId?: number,
  limit: number = 100
): Promise<any> {
  const params: Record<string, any> = { limit };
  if (sinceId) params["filter[sinceId]"] = sinceId;
  return retailcrmRequest(config, "/customers/history", "GET", params);
}

// Products/Store API
export async function getProducts(
  config: RetailcrmConfig,
  filter: Record<string, any> = {},
  page: number = 1,
  limit: number = 20
): Promise<any> {
  return retailcrmRequest(config, "/store/products", "GET", {
    ...filter,
    page,
    limit,
  });
}

export async function getInventories(
  config: RetailcrmConfig,
  filter: Record<string, any> = {},
  page: number = 1,
  limit: number = 100
): Promise<any> {
  return retailcrmRequest(config, "/store/inventories", "GET", {
    ...filter,
    page,
    limit,
  });
}

// Reference data API
export async function getStores(config: RetailcrmConfig): Promise<any> {
  return retailcrmRequest(config, "/reference/stores");
}

export async function getStatuses(config: RetailcrmConfig): Promise<any> {
  return retailcrmRequest(config, "/reference/statuses");
}

export async function getDeliveryTypes(config: RetailcrmConfig): Promise<any> {
  return retailcrmRequest(config, "/reference/delivery-types");
}

export async function getPaymentTypes(config: RetailcrmConfig): Promise<any> {
  return retailcrmRequest(config, "/reference/payment-types");
}

export async function getOrderMethods(config: RetailcrmConfig): Promise<any> {
  return retailcrmRequest(config, "/reference/order-methods");
}

// Statistics
export async function getStatistics(config: RetailcrmConfig): Promise<{
  ordersCount: number;
  customersCount: number;
  totalRevenue: number;
}> {
  try {
    const ordersData = await getOrders(config, {}, 1, 1);
    const customersData = await getCustomers(config, {}, 1, 1);
    
    return {
      ordersCount: ordersData.pagination?.totalCount || 0,
      customersCount: customersData.pagination?.totalCount || 0,
      totalRevenue: 0,
    };
  } catch (error) {
    return {
      ordersCount: 0,
      customersCount: 0,
      totalRevenue: 0,
    };
  }
}

export async function getStatusGroups(config: RetailcrmConfig): Promise<any> {
  return retailcrmRequest(config, "/reference/status-groups");
}

export async function getSites(config: RetailcrmConfig): Promise<any> {
  return retailcrmRequest(config, "/reference/sites");
}

export async function getCustomFields(config: RetailcrmConfig, entity: string = "order"): Promise<any> {
  const baseUrl = getBaseUrl(config.subdomain);
  const url = new URL(`${baseUrl}/custom-fields`);
  url.searchParams.set("apiKey", config.apiKey);
  url.searchParams.set("limit", "100");
  url.searchParams.set("entity", entity);

  const response = await fetch(url.toString(), { method: "GET" });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`RetailCRM API error: ${response.status} - ${errorText}`);
  }
  const data = await response.json();
  if (!data.success) {
    throw new Error(`RetailCRM API error: ${data.errorMsg || "Unknown error"}`);
  }
  return data;
}

export async function getCustomFieldDictionaries(config: RetailcrmConfig): Promise<any> {
  return retailcrmRequest(config, "/custom-fields/dictionaries");
}

async function fetchOrdersPageByCreatedDate(
  config: RetailcrmConfig,
  filter: { createdAtFrom?: string; createdAtTo?: string; statuses?: string[] } = {},
  page: number = 1,
  limit: number = 100,
  externalSignal?: AbortSignal,
): Promise<any> {
  const baseUrl = getBaseUrl(config.subdomain);
  const url = new URL(`${baseUrl}/orders`);

  url.searchParams.set("apiKey", config.apiKey);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));

  if (filter.createdAtFrom) {
    url.searchParams.set("filter[createdAtFrom]", filter.createdAtFrom);
  }
  if (filter.createdAtTo) {
    url.searchParams.set("filter[createdAtTo]", filter.createdAtTo);
  }
  if (filter.statuses && filter.statuses.length > 0) {
    for (const status of filter.statuses) {
      url.searchParams.append("filter[statuses][]", status);
    }
  }

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), 30000);
  const signals = externalSignal
    ? [timeoutController.signal, externalSignal]
    : [timeoutController.signal];
  const combinedController = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) { combinedController.abort(); break; }
    sig.addEventListener("abort", () => combinedController.abort(), { once: true });
  }
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: combinedController.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`RetailCRM API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(`RetailCRM API error: ${data.errorMsg || "Unknown error"}`);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getAllOrdersForDateRange(
  config: RetailcrmConfig,
  createdAtFrom: string,
  createdAtTo: string,
  onPageProgress?: PageProgressCallback,
  abortSignal?: AbortSignal,
): Promise<any[]> {
  const allOrders: any[] = [];
  let currentPage = 1;
  let totalPages = 1;

  do {
    if (abortSignal?.aborted) throw new Error("Sync cancelled");

    const pageData = await fetchOrdersPageByCreatedDate(
      config,
      { createdAtFrom, createdAtTo },
      currentPage,
      100,
      abortSignal,
    );

    if (pageData.orders) {
      allOrders.push(...pageData.orders);
    }

    totalPages = pageData.pagination?.totalPageCount || 1;
    if (onPageProgress) onPageProgress(currentPage, totalPages);
    currentPage++;

    if (currentPage > 500) break;
    if (currentPage <= totalPages) {
      await new Promise(r => setTimeout(r, 250));
    }
  } while (currentPage <= totalPages);

  return allOrders;
}

export interface PageProgressCallback {
  (currentPage: number, totalPages: number): void;
}

export async function getAllOrdersForDateRangeWithStatuses(
  config: RetailcrmConfig,
  createdAtFrom: string,
  createdAtTo: string,
  statuses: string[],
  onPageProgress?: PageProgressCallback
): Promise<any[]> {
  const statusSet = new Set(statuses);

  // Try with status filter first, but RetailCRM API filter[statuses][]
  // doesn't work on some accounts (returns 400 error or empty results)
  let statusFilterWorks = false;
  let allOrders: any[] = [];
  let currentPage = 1;
  let totalPages = 1;

  try {
    const firstPage = await fetchOrdersPageByCreatedDate(
      config,
      { createdAtFrom, createdAtTo, statuses },
      1,
      100
    );

    if (firstPage.orders && firstPage.orders.length > 0) {
      statusFilterWorks = true;
      allOrders.push(...firstPage.orders);
      totalPages = firstPage.pagination?.totalPageCount || 1;
      if (onPageProgress) {
        onPageProgress(1, totalPages);
      }
    }
  } catch (e) {
    // Status filter not supported, will fallback below
  }

  if (!statusFilterWorks) {
    // Fallback: fetch all orders and filter server-side
    allOrders = [];
    currentPage = 1;
    totalPages = 1;

    do {
      const pageData = await fetchOrdersPageByCreatedDate(
        config,
        { createdAtFrom, createdAtTo },
        currentPage,
        100
      );

      if (pageData.orders) {
        for (const order of pageData.orders) {
          if (statusSet.has(order.status)) {
            allOrders.push(order);
          }
        }
      }

      totalPages = pageData.pagination?.totalPageCount || 1;
      if (onPageProgress) {
        onPageProgress(currentPage, totalPages);
      }
      currentPage++;

      if (currentPage > 500) break;
    } while (currentPage <= totalPages);

    return allOrders;
  }

  // Continue with status filter if first page worked
  currentPage = 2;
  while (currentPage <= totalPages) {
    const pageData = await fetchOrdersPageByCreatedDate(
      config,
      { createdAtFrom, createdAtTo, statuses },
      currentPage,
      100
    );

    if (pageData.orders) {
      allOrders.push(...pageData.orders);
    }

    totalPages = pageData.pagination?.totalPageCount || 1;
    if (onPageProgress) {
      onPageProgress(currentPage, totalPages);
    }
    currentPage++;

    if (currentPage > 500) break;
  }

  return allOrders;
}

export async function getAllOrdersByStatusesDirect(
  config: RetailcrmConfig,
  statusCodes: string[],
  onPageProgress?: PageProgressCallback,
  shouldAbort?: () => boolean,
): Promise<any[]> {
  const statusSet = new Set(statusCodes);
  const toStr = new Date().toISOString().split("T")[0] + " 23:59:59";

  console.log(`getAllOrdersByStatusesDirect: querying CRM for ${statusCodes.length} statuses`);

  let statusFilterWorks = false;
  let allOrders: any[] = [];
  let currentPage = 1;
  let totalPages = 1;

  try {
    const testPage = await fetchOrdersPageByCreatedDate(
      config,
      { createdAtFrom: "2020-01-01 00:00:00", createdAtTo: toStr, statuses: statusCodes },
      1, 100,
    );

    if (testPage.orders && testPage.pagination) {
      statusFilterWorks = true;
      allOrders.push(...testPage.orders);
      totalPages = testPage.pagination.totalPageCount || 1;
      console.log(`getAllOrdersByStatusesDirect: status filter works! totalPages=${totalPages}, totalCount=${testPage.pagination.totalCount || 0}`);
      if (onPageProgress) onPageProgress(1, totalPages);
      currentPage = 2;
    }
  } catch (e: any) {
    console.log(`getAllOrdersByStatusesDirect: status filter failed (${e.message}), falling back to cache+patch`);
  }

  if (statusFilterWorks) {
    while (currentPage <= totalPages) {
      if (shouldAbort?.()) throw new Error("Отменено пользователем");

      const pageData = await fetchOrdersPageByCreatedDate(
        config,
        { createdAtFrom: "2020-01-01 00:00:00", createdAtTo: toStr, statuses: statusCodes },
        currentPage, 100,
      );

      if (pageData.orders) {
        allOrders.push(...pageData.orders);
      }

      totalPages = pageData.pagination?.totalPageCount || 1;
      if (onPageProgress) onPageProgress(currentPage, totalPages);
      currentPage++;
      if (currentPage > 500) break;
      if (currentPage <= totalPages) {
        await new Promise(r => setTimeout(r, 125));
      }
    }

    console.log(`getAllOrdersByStatusesDirect: loaded ${allOrders.length} orders via status filter from ${currentPage - 1} pages`);
    return allOrders;
  }

  const recentDays = 7;
  const recentFrom = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  console.log(`getAllOrdersByStatusesDirect: fallback — fetching recent changes since ${recentFrom} + cache`);

  const recentOrders: any[] = [];
  currentPage = 1;
  totalPages = 1;
  const recentOrderIds = new Set<string>();

  do {
    if (shouldAbort?.()) throw new Error("Отменено пользователем");

    const pageData = await fetchOrdersPage(config, {
      statusUpdatedAtFrom: recentFrom,
    }, currentPage, 100);

    if (pageData.orders) {
      for (const order of pageData.orders) {
        recentOrderIds.add(String(order.id));
        if (statusSet.has(order.status)) {
          recentOrders.push(order);
        }
      }
    }

    totalPages = pageData.pagination?.totalPageCount || 1;
    if (onPageProgress) onPageProgress(currentPage, totalPages);
    currentPage++;
    if (currentPage > 500) break;
    if (currentPage <= totalPages) {
      await new Promise(r => setTimeout(r, 125));
    }
  } while (currentPage <= totalPages);

  console.log(`getAllOrdersByStatusesDirect: fallback — ${recentOrders.length} matching from recent, ${recentOrderIds.size} total recent`);
  return recentOrders;
}
