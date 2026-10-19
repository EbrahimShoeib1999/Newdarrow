/**
 * D-Arrow Business — Client Demo Environment Runner
 * Orchestrates Firebase Emulators, Seeds Controlled Demo Accounts & Integrated Data,
 * and launches Vite Dev Server for interactive Client Demonstrations.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";

const VITE_PORT = process.env.PORT || 5173;
const PROJECT_ID = "demo-darrow";
const AUTH_PORT = 9099;
const FIRESTORE_PORT = 8080;
const STORAGE_PORT = 9199;

console.log("\n========================================================================");
console.log(" D-Arrow Business — Starting Client Demo Environment");
console.log("========================================================================\n");

// 1. Seed Auth Emulator Accounts
console.log("1. Seeding controlled demo accounts in Firebase Auth emulator...");

const DEMO_ACCOUNTS = [
  {
    email: "admin@darrow.com",
    password: "admin123",
    name: "Salem Al-Rashid",
    nameAr: "سالم الراشد",
    role: "admin",
    companyId: "d-arrow",
  },
  {
    email: "sara@darrow.com",
    password: "sara123",
    name: "Sara Ahmed",
    nameAr: "سارة أحمد",
    role: "manager",
    companyId: "d-arrow",
  },
  {
    email: "omar@darrow.com",
    password: "omar123",
    name: "Omar Hassan",
    nameAr: "عمر حسن",
    role: "employee",
    companyId: "d-arrow",
  },
];

const userIds = {};

for (const acc of DEMO_ACCOUNTS) {
  try {
    const res = await fetch(`http://127.0.0.1:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: acc.email,
        password: acc.password,
        returnSecureToken: true,
      }),
    });
    const data = await res.json();
    if (data.localId) {
      userIds[acc.email] = data.localId;
    } else {
      // User might already exist in emulator session
      const signInRes = await fetch(`http://127.0.0.1:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: acc.email,
          password: acc.password,
          returnSecureToken: true,
        }),
      });
      const signInData = await signInRes.json();
      userIds[acc.email] = signInData.localId;
    }
    console.log(`  ✓ Auth user ready: ${acc.email} (${acc.role})`);
  } catch (err) {
    console.error(`  ✗ Failed creating auth user ${acc.email}:`, err.message);
  }
}

// 2. Seed Firestore with Complete Integrated Business Data
console.log("\n2. Initializing Firestore with integrated demo records...");
const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  const companyId = "d-arrow";

  // Users
  for (const acc of DEMO_ACCOUNTS) {
    const uid = userIds[acc.email] || `usr-${acc.role}`;
    await setDoc(doc(db, "users", uid), {
      email: acc.email,
      name: acc.name,
      nameAr: acc.nameAr,
      role: acc.role,
      companyId: acc.companyId,
      companyName: "D-Arrow Business Solutions",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // Company Profile
  await setDoc(doc(db, "companies", companyId), {
    id: companyId,
    name: "D-Arrow Business Solutions",
    nameAr: "دي-آرو للأعمال والحلول الرقمية",
    currency: "SAR",
    taxNumber: "300012345600003",
    commercialRegister: "1010123456",
    phone: "+966112345678",
    email: "info@darrow.com",
    city: "الرياض",
    country: "SA",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Chart of Accounts
  const accounts = [
    { id: "acc_1010", code: "1010", nameAr: "الصندوق - نقدية باليد", nameEn: "Cash on Hand", type: "asset", subType: "current_asset", balance: 50000, isActive: true },
    { id: "acc_1020", code: "1020", nameAr: "البنك الأهلي السعودي", nameEn: "SNB Bank Account", type: "asset", subType: "current_asset", balance: 250000, isActive: true },
    { id: "acc_1200", code: "1200", nameAr: "العملاء والمدينون", nameEn: "Accounts Receivable", type: "asset", subType: "current_asset", balance: 23000, isActive: true },
    { id: "acc_2100", code: "2100", nameAr: "الموردون والدائنون", nameEn: "Accounts Payable", type: "liability", subType: "current_liability", balance: 15000, isActive: true },
    { id: "acc_2200", code: "2200", nameAr: "ضريبة القيمة المضافة المستحقة (15%)", nameEn: "VAT Output Tax", type: "liability", subType: "current_liability", balance: 3000, isActive: true },
    { id: "acc_4100", code: "4100", nameAr: "إيرادات تطوير البرمجيات والحلول الرقمية", nameEn: "Software & Digital Solutions Revenue", type: "revenue", subType: "operating_revenue", balance: 20000, isActive: true },
    { id: "acc_4200", code: "4200", nameAr: "إيرادات الاستشارات والتصميم", nameEn: "Consulting & Design Revenue", type: "revenue", subType: "operating_revenue", balance: 0, isActive: true },
    { id: "acc_5100", code: "5100", nameAr: "تكاليف الخدمات السحابية والاستضافة", nameEn: "Cloud Hosting & Direct Costs", type: "expense", subType: "cost_of_sales", balance: 5000, isActive: true },
    { id: "acc_6100", code: "6100", nameAr: "الرواتب والأجور", nameEn: "Salaries & Wages", type: "expense", subType: "operating_expense", balance: 45000, isActive: true },
  ];
  for (const acc of accounts) {
    await setDoc(doc(db, "companies", companyId, "accounts", acc.id), { ...acc, companyId });
  }

  // Products
  const products = [
    { id: "prod_01", name: "تطوير برمجيات سحابية مخصصة", type: "service", price: 20000, sku: "DEV-CLOUD-01", description: "بناء وتطوير تطبيقات الويب السحابية", isActive: true },
    { id: "prod_02", name: "استشارات التحول الرقمي وحوكمة البيانات", type: "service", price: 10000, sku: "CONS-DIG-02", description: "استشارات معمارية الأنظمة وأتمتة العمليات", isActive: true },
    { id: "prod_03", name: "باقة إدارة الحملات الرقمية الشهرية", type: "service", price: 5000, sku: "MKT-CAMP-03", description: "إدارة الحملات والتسويق الرقمي", isActive: true },
  ];
  for (const prod of products) {
    await setDoc(doc(db, "companies", companyId, "products", prod.id), { ...prod, companyId });
  }

  // CRM Contacts
  const contacts = [
    {
      id: "contact-horizon-01",
      accountName: "شركة الأفق للتقنية المتقدمة",
      legalName: "شركة الأفق للتقنية المتقدمة ذ.م.م",
      entityType: "company",
      classification: "actual_client",
      relationships: ["active_client"],
      email: "info@horizon-tech.sa",
      phone: "+966551234567",
      city: "الرياض",
      taxNumber: "300099887700003",
      commercialRegister: "1010998877",
      status: "active",
      satisfaction: "satisfied",
    },
    {
      id: "contact-ruwad-02",
      accountName: "مجموعة الرواد القابضة",
      legalName: "مؤسسة الرواد القابضة للتجارة",
      entityType: "establishment",
      classification: "actual_client",
      relationships: ["new_client"],
      email: "contact@alruwad.sa",
      phone: "+966559876543",
      city: "جدة",
      taxNumber: "300055443300003",
      commercialRegister: "1010554433",
      status: "active",
      satisfaction: "satisfied",
    },
    {
      id: "contact-masar-03",
      accountName: "شركة مسار الغد للاستشارات",
      legalName: "شركة مسار الغد للاستشارات المهنية",
      entityType: "company",
      classification: "lead",
      relationships: ["lead"],
      email: "ceo@masar.sa",
      phone: "+966503344556",
      city: "الدمام",
      status: "active",
    },
  ];
  for (const c of contacts) {
    await setDoc(doc(db, "companies", companyId, "contacts", c.id), { ...c, companyId });
  }

  // CRM Deals
  const deals = [
    {
      id: "deal-platform-01",
      title: "مشروع تطوير منصة رقمية متكاملة",
      contactId: "contact-horizon-01",
      amount: 120000,
      stage: "proposal",
      probability: 70,
      expectedCloseDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      assignedTo: userIds["admin@darrow.com"] || "usr-admin",
      priority: "high",
      notes: "مشروع تطوير المنصة السحابية والتكامل المالي ونظام الإشعارات",
    },
    {
      id: "deal-marketing-02",
      title: "عقد إدارة الحملات التسويقية السنوي",
      contactId: "contact-ruwad-02",
      amount: 65000,
      stage: "negotiation",
      probability: 85,
      expectedCloseDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
      assignedTo: userIds["sara@darrow.com"] || "usr-manager",
      priority: "medium",
      notes: "إدارة الحملات الرقمية وصناعة المحتوى المرئي",
    },
  ];
  for (const d of deals) {
    await setDoc(doc(db, "companies", companyId, "deals", d.id), { ...d, companyId });
  }

  // CRM Contract
  await setDoc(doc(db, "companies", companyId, "contracts", "contract-demo-01"), {
    id: "contract-demo-01",
    title: "عقد تطوير المنصة والخدمات السحابية",
    contractNumber: "CNT-2026-001",
    dealId: "deal-platform-01",
    contactId: "contact-horizon-01",
    status: "active",
    approvalStatus: "approved",
    form: {
      title: "عقد تطوير المنصة والخدمات السحابية",
      contractNumber: "CNT-2026-001",
      dealId: "deal-platform-01",
      contactId: "contact-horizon-01",
      client: {
        name: "شركة الأفق للتقنية المتقدمة",
        taxNumber: "300099887700003",
        commercialRegister: "1010998877",
        email: "info@horizon-tech.sa",
      },
      provider: {
        name: "دي-آرو للأعمال",
        taxNumber: "300012345600003",
      },
      services: [
        {
          id: "srv-cloud-01",
          name: "بناء البنية السحابية وتكامل API",
          department: "الهندسة والبرمجيات",
          estimatedHours: 40,
          durationDays: 14,
          isConverted: true,
          convertedTaskId: "task-demo-01",
        },
        {
          id: "srv-ui-02",
          name: "تصميم واجهة المستخدم وتجربة العميل UX/UI",
          department: "التصميم والهوية",
          estimatedHours: 30,
          durationDays: 10,
          isConverted: false,
        },
      ],
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Sprints & Tasks
  await setDoc(doc(db, "companies", companyId, "sprints", "sprint-demo-01"), {
    id: "sprint-demo-01",
    name: "Sprint 2026-Q4 / إطلاق المنصة",
    status: "active",
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    companyId,
  });

  const demoTasks = [
    {
      id: "task-demo-01",
      title: "بناء البنية السحابية وتكامل API",
      description: "المهمة مرحلة تلقائياً من العقد CNT-2026-001",
      status: "done",
      priority: "high",
      type: "task",
      department: "الهندسة والبرمجيات",
      estimatedHours: 40,
      contractId: "contract-demo-01",
      dealId: "deal-platform-01",
      contactId: "contact-horizon-01",
      companyId,
      assigneeId: userIds["omar@darrow.com"] || "usr-employee",
      sprintId: "sprint-demo-01",
    },
    {
      id: "task-demo-02",
      title: "تصميم لوحات التحكم والتقارير المالية التفاعلية",
      description: "تصميم واجهات المستخدم للمحاسبة وسندات القبض والصرف",
      status: "in_progress",
      priority: "high",
      type: "task",
      department: "التصميم والهوية",
      estimatedHours: 25,
      dealId: "deal-platform-01",
      contactId: "contact-horizon-01",
      companyId,
      assigneeId: userIds["omar@darrow.com"] || "usr-employee",
      sprintId: "sprint-demo-01",
    },
    {
      id: "task-demo-03",
      title: "مراجعة واعتماد الفواتير الضريبية ZATCA Phase 2",
      description: "التحقق من صحة رموز الاستجابة السريعة QR وحقول الفوترة",
      status: "todo",
      priority: "medium",
      type: "task",
      department: "الإدارة والمالية",
      estimatedHours: 10,
      companyId,
      assigneeId: userIds["sara@darrow.com"] || "usr-manager",
      sprintId: "sprint-demo-01",
    },
  ];
  for (const t of demoTasks) {
    await setDoc(doc(db, "companies", companyId, "tasks", t.id), {
      ...t,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // Invoices & Journals
  const inv1Date = new Date();
  const inv1Due = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Invoice 1: Issued & Sent (with balanced JE and active Public Share)
  await setDoc(doc(db, "companies", companyId, "invoices", "inv_demo_01"), {
    id: "inv_demo_01",
    invoiceNumber: "INV-2026-001",
    status: "sent",
    approvalStatus: "approved",
    customerId: "contact-horizon-01",
    customerName: "شركة الأفق للتقنية المتقدمة",
    issueDate: inv1Date.toISOString(),
    dueDate: inv1Due.toISOString(),
    currency: "SAR",
    subTotal: 20000,
    totalTax: 3000,
    totalDiscount: 0,
    grandTotal: 23000,
    amountPaid: 0,
    shareToken: "share_demo_01",
    journalEntryId: "je_inv_demo_01",
    items: [
      {
        id: "item_0",
        description: "تطوير برمجيات سحابية مخصصة - المرحلة الأولى",
        quantity: 1,
        unitPrice: 20000,
        taxRate: 15,
        total: 20000,
      },
    ],
    companyId,
    createdAt: inv1Date.toISOString(),
    updatedAt: inv1Date.toISOString(),
  });

  // Balanced Journal Entry
  await setDoc(doc(db, "companies", companyId, "journals", "je_inv_demo_01"), {
    id: "je_inv_demo_01",
    entryNumber: "JE-2026-001",
    date: inv1Date.toISOString(),
    description: "إثبات فاتورة مبيعات INV-2026-001 - شركة الأفق",
    status: "posted",
    isAutoGenerated: true,
    sourceDocumentId: "inv_demo_01",
    sourceDocumentType: "invoice",
    lines: [
      { id: "line_1", accountId: "acc_1200", debit: 23000, credit: 0, description: "مدينون - شركة الأفق" },
      { id: "line_2", accountId: "acc_4100", debit: 0, credit: 20000, description: "إيرادات تطوير البرمجيات" },
      { id: "line_3", accountId: "acc_2200", debit: 0, credit: 3000, description: "ضريبة القيمة المضافة المستحقة (15%)" },
    ],
    totalDebit: 23000,
    totalCredit: 23000,
    companyId,
    createdAt: inv1Date.toISOString(),
    updatedAt: inv1Date.toISOString(),
  });

  // Invoice 2: Draft invoice ready for live demo (Issue -> Payment)
  await setDoc(doc(db, "companies", companyId, "invoices", "inv_demo_02"), {
    id: "inv_demo_02",
    invoiceNumber: "INV-2026-002",
    status: "draft",
    approvalStatus: "pending",
    customerId: "contact-ruwad-02",
    customerName: "مجموعة الرواد القابضة",
    issueDate: new Date().toISOString(),
    dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
    currency: "SAR",
    subTotal: 10000,
    totalTax: 1500,
    totalDiscount: 0,
    grandTotal: 11500,
    amountPaid: 0,
    items: [
      {
        id: "item_0",
        description: "استشارات التحول الرقمي وحوكمة البيانات",
        quantity: 1,
        unitPrice: 10000,
        taxRate: 15,
        total: 10000,
      },
    ],
    companyId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Public Invoice Share
  await setDoc(doc(db, "publicInvoiceShares", "share_demo_01"), {
    token: "share_demo_01",
    companyId,
    invoiceId: "inv_demo_01",
    status: "active",
    createdAt: inv1Date.toISOString(),
    snapshot: {
      amountDue: 23000,
      customerName: "شركة الأفق للتقنية المتقدمة",
      company: {
        name: "دي-آرو للأعمال والحلول الرقمية",
        taxNumber: "300012345600003",
      },
      invoice: {
        id: "inv_demo_01",
        invoiceNumber: "INV-2026-001",
        status: "sent",
        customerName: "شركة الأفق للتقنية المتقدمة",
        issueDate: inv1Date.toISOString(),
        dueDate: inv1Due.toISOString(),
        currency: "SAR",
        subTotal: 20000,
        totalTax: 3000,
        totalDiscount: 0,
        grandTotal: 23000,
        amountPaid: 0,
        items: [
          {
            id: "item_0",
            description: "تطوير برمجيات سحابية مخصصة - المرحلة الأولى",
            quantity: 1,
            unitPrice: 20000,
            taxRate: 15,
            total: 20000,
          },
        ],
      },
    },
  });

  // Employees & Leave Requests
  for (const acc of DEMO_ACCOUNTS) {
    const uid = userIds[acc.email] || `usr-${acc.role}`;
    await setDoc(doc(db, "companies", companyId, "employees", uid), {
      id: uid,
      name: acc.name,
      nameAr: acc.nameAr,
      email: acc.email,
      department: acc.role === "admin" ? "Management" : acc.role === "manager" ? "Sales & Operations" : "Engineering",
      position: acc.role === "admin" ? "Chief Executive Officer" : acc.role === "manager" ? "Operations Manager" : "Senior Software Engineer",
      role: acc.role,
      status: "active",
      companyId,
      joiningDate: new Date("2024-01-01").toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  await setDoc(doc(db, "companies", companyId, "leave_requests", "leave_demo_01"), {
    id: "leave_demo_01",
    employeeId: userIds["omar@darrow.com"] || "usr-employee",
    employeeName: "Omar Hassan",
    type: "vacation",
    startDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
    endDate: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString(),
    reason: "إجازة سنوية مجدولة",
    status: "approved",
    companyId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});

console.log("  ✓ Firestore seeded with Accounts, Products, Contacts, Deals, Contracts, Tasks, and Invoices!");

// 3. Start Vite dev server configured for local emulators
console.log(`\n3. Launching Vite dev server on http://localhost:${VITE_PORT}...`);
const viteProc = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--port", String(VITE_PORT), "--strictPort"],
  {
    env: {
      ...process.env,
      VITE_USE_FIREBASE_EMULATOR: "true",
      VITE_FIREBASE_EMULATOR_HOST: "127.0.0.1",
      VITE_FIREBASE_PROJECT_ID: PROJECT_ID,
      VITE_FIREBASE_AUTH_EMULATOR_PORT: String(AUTH_PORT),
      VITE_FIRESTORE_EMULATOR_PORT: String(FIRESTORE_PORT),
      VITE_FIREBASE_STORAGE_EMULATOR_PORT: String(STORAGE_PORT),
    },
    stdio: "inherit",
  }
);

viteProc.on("exit", (code) => {
  console.log(`Vite exited with code ${code}`);
  process.exit(code || 0);
});

// Graceful cleanup
process.on("SIGINT", () => {
  console.log("\nShutting down demo suite...");
  try {
    viteProc.kill();
  } catch (e) {}
  process.exit(0);
});

console.log("\n========================================================================");
console.log(" D-Arrow Business — Client Demo Environment is LIVE & READY!");
console.log("========================================================================");
console.log(` Application URL:      http://localhost:${VITE_PORT}`);
console.log(` Firebase Emulators:   Auth (9099) | Firestore (8080) | Storage (9199)`);
console.log("");
console.log(" Controlled Demo Accounts (Isolated Emulator):");
console.log("   1. Admin:    admin@darrow.com   / admin123   (Role: admin, full access)");
console.log("   2. Manager:  sara@darrow.com    / sara123    (Role: manager)");
console.log("   3. Employee: omar@darrow.com    / omar123    (Role: employee)");
console.log("");
console.log(" Public Invoice Share (Accessible without login):");
console.log(`   http://localhost:${VITE_PORT}/i/share_demo_01`);
console.log("");
console.log(" Verified Demonstration Flow:");
console.log("   1. Sign in as admin@darrow.com (or click My Workspace)");
console.log("   2. Review CRM Dashboard (/crm) & Deals Pipeline (/crm/deals)");
console.log("   3. Open 'مشروع تطوير منصة رقمية متكاملة' -> Advance stage or Click 'صياغة عقد للصفقة'");
console.log("   4. Navigate to Tasks Workspace (/tasks/work) -> Review Sprint & Kanban");
console.log("   5. Navigate to Invoices (/billing/invoices) -> Open Draft INV-2026-002");
console.log("      Click 'Approve' -> 'Issue' -> 'Record Payment' (creates Receipt Voucher + JE)");
console.log("   6. Open Public Invoice Share: http://localhost:5173/i/share_demo_01");
console.log("   7. Refresh the page -> all records and balances persist stably!");
console.log("========================================================================\n");

// Keep event loop alive
await new Promise(() => {});
