import { db } from "./firebase";
import { collection, doc, setDoc, addDoc, serverTimestamp } from "firebase/firestore";
import { mockUsers } from "../mocks/data/users.data";
import { mockTasks } from "../mocks/data/tasks.data";
import { mockComments } from "../mocks/data/comments.data";
import { mockSprints } from "../mocks/data/sprints.data";
import { mockEmployees, mockLeaveRequests } from "../mocks/data/people.data";

export async function seedFirestore() {
  console.log("Starting Firestore seeding for D-Arrow Business...");

  try {
    const companyId = "d-arrow";

    // 1. Seed Users
    console.log("Seeding users...");
    for (const user of mockUsers) {
      const { password, ...safeUser } = user;
      await setDoc(doc(db, "users", user.id), {
        ...safeUser,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    // 2. Seed Company Document with Profile
    console.log(`Seeding company document: ${companyId}...`);
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // 3. Seed Chart of Accounts (Saudi / ZATCA Standard Double-Entry)
    console.log(`Seeding Chart of Accounts for company: ${companyId}...`);
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
      await setDoc(doc(db, "companies", companyId, "accounts", acc.id), {
        ...acc,
        companyId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    // 4. Seed Products / Services Catalog
    console.log(`Seeding Products Catalog for company: ${companyId}...`);
    const products = [
      { id: "prod_01", name: "تطوير برمجيات سحابية مخصصة", type: "service", price: 20000, sku: "DEV-CLOUD-01", description: "بناء وتطوير تطبيقات الويب السحابية", isActive: true },
      { id: "prod_02", name: "استشارات التحول الرقمي وحوكمة البيانات", type: "service", price: 10000, sku: "CONS-DIG-02", description: "استشارات معمارية الأنظمة وأتمتة العمليات", isActive: true },
      { id: "prod_03", name: "باقة إدارة الحملات الرقمية الشهرية", type: "service", price: 5000, sku: "MKT-CAMP-03", description: "إدارة الحملات والتسويق الرقمي", isActive: true },
    ];
    for (const prod of products) {
      await setDoc(doc(db, "companies", companyId, "products", prod.id), {
        ...prod,
        companyId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    // 5. Seed CRM Contacts
    console.log(`Seeding CRM Contacts for company: ${companyId}...`);
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
      await setDoc(doc(db, "companies", companyId, "contacts", c.id), {
        ...c,
        companyId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    // 6. Seed CRM Deals
    console.log(`Seeding CRM Deals for company: ${companyId}...`);
    const deals = [
      {
        id: "deal-platform-01",
        title: "مشروع تطوير منصة رقمية متكاملة",
        contactId: "contact-horizon-01",
        amount: 120000,
        stage: "proposal",
        probability: 70,
        expectedCloseDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        assignedTo: "usr-001",
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
        assignedTo: "usr-002",
        priority: "medium",
        notes: "إدارة الحملات الرقمية وصناعة المحتوى المرئي",
      },
      {
        id: "deal-consulting-03",
        title: "استشارات الأتمتة وحوكمة البيانات",
        contactId: "contact-masar-03",
        amount: 45000,
        stage: "won",
        probability: 100,
        expectedCloseDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        assignedTo: "usr-001",
        priority: "high",
        notes: "عقد استشاري منتهي ومحول للتنفيذ",
      },
    ];
    for (const d of deals) {
      await setDoc(doc(db, "companies", companyId, "deals", d.id), {
        ...d,
        companyId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    // 7. Seed CRM Contracts
    console.log(`Seeding CRM Contracts for company: ${companyId}...`);
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
            convertedTaskId: "task-001",
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // 8. Seed Sprints & Tasks
    console.log(`Seeding Sprints for company: ${companyId}...`);
    for (const sprint of mockSprints) {
      const sprintRef = doc(db, "companies", companyId, "sprints", sprint.id);
      await setDoc(sprintRef, {
        ...sprint,
        createdAt: sprint.createdAt ? new Date(sprint.createdAt) : serverTimestamp(),
        updatedAt: sprint.updatedAt ? new Date(sprint.updatedAt) : serverTimestamp(),
        startDate: new Date(sprint.startDate),
        endDate: new Date(sprint.endDate),
      });
    }

    console.log(`Seeding tasks for company: ${companyId}...`);
    for (const task of mockTasks) {
      const taskRef = doc(db, "companies", companyId, "tasks", task.id);
      await setDoc(taskRef, {
        ...task,
        companyId,
        createdAt: task.createdAt ? new Date(task.createdAt) : serverTimestamp(),
        updatedAt: task.updatedAt ? new Date(task.updatedAt) : serverTimestamp(),
        dueDate: task.dueDate ? new Date(task.dueDate) : null,
      });

      const taskComments = mockComments.filter((c) => c.taskId === task.id);
      if (taskComments.length > 0) {
        const commentsRef = collection(db, "companies", companyId, "tasks", task.id, "comments");
        for (const comment of taskComments) {
          await addDoc(commentsRef, {
            ...comment,
            createdAt: comment.createdAt ? new Date(comment.createdAt) : serverTimestamp(),
            updatedAt: (comment as any).updatedAt ? new Date((comment as any).updatedAt) : serverTimestamp(),
          });
        }
      }
    }

    // 9. Seed Invoices & Balanced Journals
    console.log(`Seeding Invoices for company: ${companyId}...`);
    const invoice1Date = new Date();
    const invoice1Due = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await setDoc(doc(db, "companies", companyId, "invoices", "inv_demo_01"), {
      id: "inv_demo_01",
      invoiceNumber: "INV-2026-001",
      status: "sent",
      approvalStatus: "approved",
      customerId: "contact-horizon-01",
      customerName: "شركة الأفق للتقنية المتقدمة",
      issueDate: invoice1Date,
      dueDate: invoice1Due,
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Balanced Journal Entry for INV-2026-001 (AR Debit 23000, Revenue Credit 20000, VAT Credit 3000)
    await setDoc(doc(db, "companies", companyId, "journals", "je_inv_demo_01"), {
      id: "je_inv_demo_01",
      entryNumber: "JE-2026-001",
      date: invoice1Date,
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Invoice 2: Draft invoice ready for live demonstration (Issue -> Payment)
    await setDoc(doc(db, "companies", companyId, "invoices", "inv_demo_02"), {
      id: "inv_demo_02",
      invoiceNumber: "INV-2026-002",
      status: "draft",
      approvalStatus: "pending",
      customerId: "contact-ruwad-02",
      customerName: "مجموعة الرواد القابضة",
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // 10. Public Invoice Share for client verification
    console.log("Seeding Public Invoice Share token: share_demo_01...");
    await setDoc(doc(db, "publicInvoiceShares", "share_demo_01"), {
      token: "share_demo_01",
      companyId,
      invoiceId: "inv_demo_01",
      status: "active",
      createdAt: serverTimestamp(),
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
          issueDate: invoice1Date.toISOString(),
          dueDate: invoice1Due.toISOString(),
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

    // 11. Seed Employees & Leave Requests
    console.log(`Seeding employees for company: ${companyId}...`);
    for (const employee of mockEmployees) {
      const empRef = doc(db, "companies", companyId, "employees", employee.id);
      await setDoc(empRef, {
        ...employee,
        joiningDate: employee.joiningDate instanceof Date ? employee.joiningDate : new Date(employee.joiningDate as any),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    console.log(`Seeding leave requests for company: ${companyId}...`);
    for (const leave of mockLeaveRequests) {
      const leaveRef = doc(db, "companies", companyId, "leave_requests", leave.id);
      await setDoc(leaveRef, {
        ...leave,
        startDate: leave.startDate instanceof Date ? leave.startDate : new Date(leave.startDate as any),
        endDate: leave.endDate instanceof Date ? leave.endDate : new Date(leave.endDate as any),
        createdAt: leave.createdAt instanceof Date ? leave.createdAt : new Date(leave.createdAt as any),
        updatedAt: leave.updatedAt instanceof Date ? leave.updatedAt : new Date(leave.updatedAt as any),
      });
    }

    console.log("✓ Firestore seeding completed successfully with all integrated modules!");
  } catch (error) {
    console.error("Error seeding Firestore:", error);
    throw error;
  }
}
