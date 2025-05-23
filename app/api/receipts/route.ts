import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { pool } from "@/lib/database";
import { verifyJwt } from "@/lib/auth";

interface ReceiptItem {
  description: string;
  quantity: number;
  price: number;
  advanceAmount?: number;
  dueAmount?: number;
}

interface PaymentDetails {
  cardNumber?: string;
  phoneNumber?: string;
  phoneCountryCode?: string;
}

interface ReceiptBody {
  receiptNumber: string;
  date: string;
  customerName: string;
  customerContact: string;
  customerCountryCode: string;
  paymentType: 'cash' | 'online';
  paymentStatus: 'full' | 'advance' | 'due';
  notes?: string;
  total: number;
  dueTotal: number;
  items: ReceiptItem[];
  paymentDetails?: PaymentDetails;
}

interface JwtPayload {
  userId: string | number;
  [key: string]: any;
}

function formatLocalDateForMySQL(date: Date | string): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    throw new Error("Invalid date format");
  }
  
  // Format as YYYY-MM-DD HH:MM:SS in local time
  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function validateReceiptBody(body: ReceiptBody): string | null {
  if (!body.receiptNumber) return "Receipt number is required";
  if (!body.date) return "Date is required";
  if (!body.customerName) return "Customer name is required";
  if (!body.customerContact) return "Customer contact is required";
  
  const validTypes = ['cash', 'online'];
  if (!body.paymentType || !validTypes.includes(body.paymentType.toLowerCase())) {
    return `Payment type must be one of: ${validTypes.join(', ')}`;
  }

  const validStatuses = ['full', 'advance', 'due'];
  if (!body.paymentStatus || !validStatuses.includes(body.paymentStatus.toLowerCase())) {
    return `Payment status must be one of: ${validStatuses.join(', ')}`;
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return "At least one item is required";
  }

  for (const [index, item] of body.items.entries()) {
    if (!item.description) return `Item ${index + 1} description is required`;
    if (typeof item.quantity !== "number" || item.quantity <= 0) {
      return `Item ${index + 1} quantity must be a positive number`;
    }
    if (typeof item.price !== "number" || item.price < 0) {
      return `Item ${index + 1} price must be a non-negative number`;
    }
  }

  if (body.paymentStatus === 'full' && body.dueTotal !== 0) {
    return "Due total must be 0 for full payment";
  }
  if (body.paymentStatus === 'advance' && body.dueTotal <= 0) {
    return "Due total must be positive for advance payment";
  }
  if (body.paymentStatus === 'due' && body.total <= 0) {
    return "Total must be positive for due payment";
  }

  return null;
}

async function createReceipt(
  connection: mysql.PoolConnection,
  body: ReceiptBody,
  userId: string
): Promise<number> {
  const normalizedStatus = body.paymentStatus.toLowerCase();
  const normalizedType = body.paymentType.toLowerCase();
  const createdAt = formatLocalDateForMySQL(new Date());
  const formattedDate = formatLocalDateForMySQL(body.date);

  const [result] = await connection.query<mysql.ResultSetHeader>(
    `INSERT INTO receipts (
      receipt_number, date, customer_name, customer_contact, customer_country_code,
      payment_type, payment_status, notes, total, due_total, user_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      body.receiptNumber,
      formattedDate,
      body.customerName,
      body.customerContact,
      body.customerCountryCode,
      normalizedType,
      normalizedStatus,
      body.notes || null,
      body.total,
      body.dueTotal,
      userId,
      createdAt,
    ]
  );

  return result.insertId;
}

async function processReceiptItems(
  connection: mysql.PoolConnection,
  receiptId: number,
  items: ReceiptItem[]
): Promise<void> {
  for (const item of items) {
    await connection.query(
      `INSERT INTO receipt_items (
        receipt_id, description, quantity, price, advance_amount, due_amount
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        receiptId,
        item.description,
        item.quantity,
        item.price,
        item.advanceAmount ?? 0,
        item.dueAmount ?? 0,
      ]
    );
  }
}

async function processPaymentDetails(
  connection: mysql.PoolConnection,
  receiptId: number,
  paymentDetails: PaymentDetails
): Promise<void> {
  await connection.query(
    `INSERT INTO payment_details (
      receipt_id, card_number, phone_number, phone_country_code
    ) VALUES (?, ?, ?, ?)`,
    [
      receiptId,
      paymentDetails.cardNumber || null,
      paymentDetails.phoneNumber || null,
      paymentDetails.phoneCountryCode || null,
    ]
  );
}

async function processDueRecords(
  connection: mysql.PoolConnection,
  receiptId: number,
  body: ReceiptBody,
  userId: string
): Promise<void> {
  if (body.paymentStatus === 'due') {
    const productOrdered = body.items.map((i) => i.description).join(", ");
    const totalQuantity = body.items.reduce((sum, i) => sum + i.quantity, 0);
    const expectedPaymentDate = new Date();
    expectedPaymentDate.setDate(expectedPaymentDate.getDate() + 7);

    await connection.query(
      `INSERT INTO due_records (
        customer_name, customer_contact, customer_country_code,
        product_ordered, quantity, amount_due, expected_payment_date,
        user_id, receipt_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.customerName,
        body.customerContact,
        body.customerCountryCode,
        productOrdered,
        totalQuantity,
        body.dueTotal,
        expectedPaymentDate.toISOString().split("T")[0],
        userId,
        body.receiptNumber,
      ]
    );
  }
}

async function processAccountTransaction(
  connection: mysql.PoolConnection,
  receiptId: number,
  body: ReceiptBody,
  userId: string
): Promise<void> {
  const createdAt = formatLocalDateForMySQL(new Date());
  
  let transactionAmount = 0;
  let particulars = '';
  
  if (body.paymentStatus === 'full') {
    transactionAmount = body.total;
    particulars = `Full payment from ${body.customerName} (Receipt: ${body.receiptNumber})`;
  } else if (body.paymentStatus === 'advance') {
    transactionAmount = body.total - body.dueTotal;
    particulars = `Advance payment from ${body.customerName} (Receipt: ${body.receiptNumber})`;
  } else if (body.paymentStatus === 'due') {
    return;
  }

  if (transactionAmount > 0) {
    await connection.query(
      `INSERT INTO account_transactions (
        particulars, amount, type, user_id, receipt_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        particulars,
        transactionAmount,
        "credit",
        userId,
        receiptId,
        createdAt,
      ]
    );
  }
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.split(" ")[1];
  let connection: mysql.PoolConnection | undefined;

  try {
    const decoded = await verifyJwt(token);
    if (!decoded?.userId) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    const userId = String(decoded.userId);

    const body: ReceiptBody = await request.json();
    const validationError = validateReceiptBody(body);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const receiptId = await createReceipt(connection, body, userId);
    await processReceiptItems(connection, receiptId, body.items);

    if (body.paymentDetails) {
      await processPaymentDetails(connection, receiptId, body.paymentDetails);
    }

    if (body.paymentStatus !== "full" && body.dueTotal > 0) {
      await processDueRecords(connection, receiptId, body, userId);
    }

    if (body.total > 0) {
      await processAccountTransaction(connection, receiptId, body, userId);
    }

    await connection.commit();

    return NextResponse.json({
      success: true,
      receiptId,
      message: "Receipt created successfully",
    });
  } catch (error: unknown) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback failed:", rollbackError);
      }
    }

    let errorMessage = "Unknown error occurred";
    if (error instanceof Error) {
      errorMessage = error.message;
      if (error.message.includes('Data truncated for column')) {
        errorMessage = "Invalid payment status value provided";
      }
    }
    
    console.error("Receipt creation error:", error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  } finally {
    if (connection) {
      await connection.release();
    }
  }
}