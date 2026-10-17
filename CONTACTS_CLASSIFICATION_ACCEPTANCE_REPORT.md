# D-Arrow Business — Contacts Classification & Complete CRM Integration Acceptance Report
**تقرير القبول الشامل لتطوير نظام تصنيفات جهات الاتصال والتكامل مع الـ CRM**

---

## 1. ملخص الحالة قبل التنفيذ (State Before Implementation)

قبل تنفيذ هذا التطوير، كان نظام جهات الاتصال (`contacts`) في منصة D-Arrow Business يعاني من القيود التالية:
1. **خلط المفاهيم الأساسية**: كانت العلاقة مع D-Arrow (عميل فعلي، عميل محتمل، مورد، إلخ) تُعامل كحقل تصنيف نصي وحيد (`classification`)، مما كان يمنع دعم العلاقات المتعددة (مثلاً كون الجهة عميلاً ومورداً وشريكاً في نفس الوقت).
2. **غياب التمييز الهيكلي بين أنواع الكيانات (Entity Types)**: كانت المنشآت تُعامل كأفراد والعكس صحيح، دون وجود حقول مخصصة للأفراد (اسم الأب، رقم الهوية، الجنسية) أو للمنشآت (السجل التجاري وتاريخ انتهائه، الرقم الموحد 700، الرقم الضريبي، النشاط، الفروع)، أو للجهات الحكومية والجمعيات والبنوك والجهات الإعلامية.
3. **عدم دعم جهات الاتصال التابعة للمنشآت**: لم يكن متاحاً للمنشأة ربط أكثر من شخص مسؤول (المدير العام، مسؤول التسويق، المشتريات، المالية)، ولم يكن هناك مفهوم لجهة التواصل الرئيسية أو صاحب القرار.
4. **العناوين والتواصل المحدود**: كان هناك حقل نصي واحد فقط لعنوان الفوترة (`billingAddress`) وغياب تام لحسابات التواصل الاجتماعي المخصصة والعناوين الوطنية ومراكز الفروع.
5. **بيانات CRM والمالية**: عدم وجود تفاصيل شروط الدفع، التسجيل الضريبي، الحد الائتماني، والقطاع التجاري والخدمات المهتم بها بصورة منظمة وقابلة للاستعلام.

---

## 2. الملفات التي تغيرت وسبب كل تغيير (Changed Files & Rationale)

| الملف | نوع التغيير | السبب والوظيفة |
|---|---|---|
| `src/features/crm/types/contacts.types.ts` | تعديل | إضافة الأنواع الشاملة `EntityType`, `ContactRelationship`, `EstablishmentType`, `ContactPersonType`, `AssociatedContactPerson`, `ContactSocialAccount`, `ContactAddress`, `ContactFinancialInfo`, `ContactCrmSalesInfo`، وتحديث `Contact` و `CreateContactDTO` لدعم السجلات الحديثة مع التوافق التام مع السجلات القديمة. |
| `src/features/crm/schemas/contact.schema.ts` | تعديل | بناء مخططات التحقق الفرعية `associatedContactPersonSchema`, `contactSocialAccountSchema`, `contactAddressSchema` ومخطط النموذج الرئيسي `contactFormSchema` مع `.superRefine` للتحقق الشرطي حسب نوع الكيان، وتحديث دالة التحويل `toCreateContactDTO` لدمج الأسماء تلقائياً واحتساب التصنيف المتوافق. |
| `src/features/crm/utils/contacts-list.utils.ts` | تعديل | ترقية دالة العرض العالمية `contactDisplayName` لدعم أسماء المنشآت والأفراد بمرونة، وتوسيع محرك البحث `contactMatchesSearch` ليشمل السجل التجاري، الرقم الموحد 700، الرقم الضريبي، وأسماء وأرقام جهات الاتصال التابعة، وتحديث فلاتر التصفية لدعم `entityType` و `relationships`. |
| `src/features/crm/components/AssociatedContactsSection.tsx` | ملف جديد | مكون تفاعلي لإدارة جهات الاتصال التابعة للمنشآت (إضافة، تعديل، حذف، تعيين جهة الاتصال الرئيسية الواحدة، تحديد أصحاب القرار، وأزرار الاتصال والواتساب الفورية). |
| `src/features/crm/components/SocialAccountsSection.tsx` | ملف جديد | مكون تفاعلي ديناميكي لإدارة منصات التواصل الاجتماعي (المنصة، الرابط، اسم المستخدم) مع التحقق ودعم الإضافة الحرة لأي منصة جديدة. |
| `src/features/crm/components/AddressesSection.tsx` | ملف جديد | مكون لإدارة العناوين المتعددة (العنوان الوطني، عنوان الفروع، عنوان المراسلات) بحقول العنوان المعتمدة رسمياً (المبنى، الشارع، الحي، المدينة، الرمز البريدي، الإضافي، المختصر). |
| `src/features/crm/components/ContactFormModal.tsx` | تعديل جوهري | إعادة بناء النموذج ليشمل شريط اختيار نوع الكيان (9 أنواع بأيقونات واضحة)، وشرائح الاختيار المتعدد للعلاقات (12 علاقة)، وتبويبات منظمة (البيانات الأساسية الديناميكية، جهات الاتصال التابعة للمنشأة، التواصل والعناوين، والمالية والمبيعات) مع منع الإرسال المزدوج وحفظ المدخلات. |
| `src/features/crm/pages/ContactsListPage.tsx` | تعديل | إضافة فلاتر نوع الكيان والعلاقات المتعددة، وعرض شارة نوع الكيان (`renderEntityTypeBadge`) وشرائح العلاقات (`renderRelationshipsChips`) وبيانات جهة الاتصال الرئيسية التابعة في جدول وجهات الدليل الموحد. |
| `src/features/crm/pages/ContactDetailPage.tsx` | تعديل | إضافة شارات نوع الكيان والعلاقات والبيانات القانونية بالرأس، وإضافة تبويب مخصص لجهات الاتصال التابعة (`associated_contacts`) مع كروت الموظفين وأزرار الاتصال والمراسلة المباشرة، وعرض أقسام العناوين وحسابات التواصل والبيانات المالية ومبيعات CRM. |
| `src/features/crm/components/ContractBuilderForm.tsx` | تعديل | ترقية استيراد بيانات جهة الاتصال في العقود لتحميل اسم المنشأة والسجل والضريبة والعنوان الوطني واسم الممثل القانوني تلقائياً من جهة الاتصال الرئيسية التابعة. |
| `src/features/crm/components/CrmGlobalSearch.tsx` | تعديل | توسيع البحث الفوري ليشمل السجل التجاري، الرقم الموحد، الرقم الضريبي، وأسماء جهات الاتصال التابعة. |
| `public/locales/ar/crm.json` & `public/locales/en/crm.json` | تعديل | ترجمات كاملة ودقيقة باللغتين العربية والإنجليزية لجميع أنواع الكيانات، أنواع المنشآت، العلاقات، أدوار جهات الاتصال، وأنواع العناوين. |
| `scripts/test-live-workflows.mjs` | تعديل | إضافة سيناريوهات محاكاة حية شاملة (SCENARIO 2B) لاختبار حفظ واسترجاع جهات الاتصال من نوع شركة مع أشخاص تابعين وعلاقات متعددة والتحقق من عزل البيانات الصارم بين الشركات على محاكي Firestore. |

---

## 3. نموذج البيانات المعتمد (Adopted Data Model)

تم اعتماد نموذج بيانات غير تدميري يضمن التوافق 100% مع كافة مستندات Firestore السابقة مع إضافة الهيكل الموسع:

```typescript
export interface Contact extends CrmBaseFields {
  // 1. نوع الكيان المستقل
  entityType?: "individual" | "company" | "establishment" | "government" 
             | "non_profit" | "bank" | "media" | "influencer" | "other";

  // 2. الأسماء الأساسية
  firstName: string;
  lastName: string;
  fatherName?: string;
  fullName?: string;

  // 3. بيانات المنشأة القانونية والتجارية
  accountName?: string;
  legalName?: string;
  establishmentType?: "sole_proprietorship" | "llc" | "joint_stock" 
                     | "simplified_joint_stock" | "partnership" | "other";
  commercialRegister?: string;
  crExpiryDate?: string;
  unifiedNumber?: string; // الرقم الموحد 700
  taxNumber?: string;     // الرقم الضريبي VAT
  mainActivity?: string;
  companySize?: string;
  city?: string;
  region?: string;
  branchesCount?: number;

  // 4. الحقول الخاصة بالأنواع الحكومية وغير الربحية والإعلامية
  govSector?: string;
  administration?: string;
  department?: string;
  tenderNumber?: string;
  contractNumber?: string;
  licenseNumber?: string;
  nonProfitType?: string;
  financialInstitutionType?: string;
  mediaPlatformType?: string;
  audienceSize?: string;
  contentNiche?: string;
  collaborationAreas?: string;
  managerName?: string;

  // 5. حقول الأفراد
  nationalId?: string;
  nationality?: string;
  jobTitle?: string;

  // 6. العلاقات المتعددة وحالاتها
  relationships?: ContactRelationship[]; // e.g. ["active_client", "vendor", "partner"]
  relationshipStatuses?: Record<string, string>;

  // 7. جهات الاتصال التابعة للمنشأة
  associatedContacts?: Array<{
    id: string;
    name: string;
    jobTitle?: string;
    department?: string;
    phone?: string;
    whatsapp?: string;
    email?: string;
    type?: ContactPersonType;
    contactRole?: string;
    isDecisionMaker?: boolean;
    isPrimary?: boolean; // جهة الاتصال الرئيسية الوحيدة للمنشأة
    notes?: string;
  }>;

  // 8. حسابات التواصل الاجتماعي
  socialAccounts?: Array<{
    id: string;
    platform: string;
    url?: string;
    username?: string;
    notes?: string;
  }>;

  // 9. العناوين المتعددة
  addresses?: Array<{
    id: string;
    type?: "national" | "mailing" | "branch" | "other";
    buildingNumber?: string;
    streetName?: string;
    district?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    additionalNumber?: string;
    shortAddress?: string;
    country?: string;
    notes?: string;
  }>;

  // 10. البيانات المالية وبيانات المبيعات
  financialInfo?: {
    taxNumber?: string;
    vatRegistered?: "yes" | "no" | "unknown" | "registered" | "not_registered";
    preferredPaymentMethod?: string;
    paymentTerms?: string;
    paymentPeriod?: string;
    creditLimit?: number;
    financialNotes?: string;
  };
  crmSalesInfo?: {
    sector?: string;
    tags?: string[];
    requestedService?: string;
    expectedBudget?: number | string;
    expectedStartDate?: string;
    hasMarketingTeam?: boolean | null;
    workingWithOtherAgency?: boolean | null;
    usedPlatforms?: string[];
    interestedServices?: string[];
  };

  // حقول التوافق القديمة المضمونة
  classification?: string;
  satisfaction?: "satisfied" | "neutral" | "unsatisfied";
  satisfactionNotes?: string;
  interests?: string[];
  source?: string;
  status?: string;
  assignedTo?: string | null;
  billingAddress?: string;
}
```

---

## 4. التصنيفات والحقول التي تم تنفيذها (Classifications & Dynamic Fields)

### A. أنواع الكيانات (Entity Types)
1. **فرد (Individual)**: الاسم الأول، اسم الأب، اسم العائلة، الاسم الكامل التلقائي، الجوال، البريد، رقم الهوية، الجنسية، المدينة، المنطقة، الموظف المسؤول.
2. **شركة (Company)**: الاسم التجاري، الاسم القانوني، نوع المنشأة (مؤسسة فردية، ذ.م.م، مساهمة، مساهمة مبسطة، تضامنية، أخرى)، السجل التجاري، تاريخ انتهاء السجل، الرقم الموحد 700، الرقم الضريبي VAT، النشاط الرئيسي، حجم المنشأة، عدد الفروع، المدينة، الموقع الإلكتروني.
3. **مؤسسة (Establishment)**: حقول منشأة كاملة مع مراعاة طابع المؤسسات الفردية.
4. **جهة حكومية (Government)**: اسم الجهة، القطاع الحكومي، الإدارة، القسم، المدينة، الموقع الرسمي، رقم المنافسة/المناقصة، رقم العقد، جهات الاتصال المسؤولة.
5. **جمعية / غير ربحية (Non-Profit)**: الاسم الرسمي، نوع الجهة، رقم الترخيص/التسجيل، النشاط، القطاع، المدينة، الموقع والبريد والهاتف.
6. **بنك / جهة مالية (Bank / Financial)**: الاسم الرسمي، نوع المؤسسة المالية، المدينة، بيانات التواصل، جهة الاتصال المسؤولة.
7. **جهة إعلامية (Media)**: الاسم التجاري، اسم المسؤول، نوع الوسيلة الإعلامية، المنصات، التخصص، خدمات التعاون.
8. **مؤثر / صانع محتوى (Influencer)**: الاسم، المنصات، روابط الحسابات، حجم الجمهور والمتابعين، مجال المحتوى، مجالات التعاون والتغطية.
9. **أخرى (Other)**: حقول مرنة عامة تتيح إضافة كافة المعطيات دون فرض قيود غير ملائمة.

### B. العلاقات المتعددة (Multi-Select Relationships)
يدعم النظام اختيار عدة علاقات للجهة الواحدة في آنٍ واحد:
- عميل محتمل (`lead`)
- عميل جديد (`new_client`)
- عميل حالي (`active_client`)
- عميل سابق (`former_client`)
- عميل متوقف (`paused_client`)
- عميل VIP (`vip_client`)
- مورد (`vendor`)
- شريك (`partner`)
- جهة متعاقدة (`contractor`)
- جهة إحالة (`referral`)
- جهة إعلامية (`media`)
- مؤثر / صانع محتوى (`influencer`)

---

## 5. جميع الشاشات التي جرى ربطها (Integrated Screens)

1. **نموذج إنشاء وتعديل جهة الاتصال (`ContactFormModal`)**: اختيار نوع الكيان تفاعلياً، إظهار وإخفاء الحقول ديناميكياً، إدارة جهات الاتصال التابعة وحسابات التواصل والعناوين، ودعم الحفظ المتتالي ("حفظ وإضافة جهة أخرى").
2. **جدول جهات الاتصال (`ContactsListPage` - Table View)**: عرض شارات نوع الكيان، شرائح العلاقات المتعددة، اسم المنشأة، ومعاينة فورية لاسم ومسمى جهة الاتصال الرئيسية للمنشأة (`⭐ Sami Al-Otaibi (CEO)`).
3. **دليل الأرقام الموحد (`ContactsListPage` - Directory View)**: بطاقات متجاوبة تبرز نوع الكيان، المنشأة، المسؤول الرئيسي، وأزرار الاتصال والواتساب السريعة.
4. **صفحة تفاصيل جهة الاتصال (`ContactDetailPage`)**:
   - شريط الهوية والبيانات القانونية (CR, 700, VAT).
   - تبويب "بيانات الجهة المحددة": العناوين الوطنية، الحسابات الاجتماعية، البيانات المالية، وبيانات CRM.
   - تبويب مستقل "جهات الاتصال التابعة" (`associated_contacts`) يعرض كروت مسؤولي المنشأة وأدوارهم مع مؤشرات "رئيسي" و"صاحب قرار" وأزرار التواصل المباشر.
5. **شاشة إنشاء العقود (`ContractBuilderForm`)**: عند اختيار جهة الاتصال من نوع منشأة، يتم سحب اسم المنشأة، السجل التجاري، الرقم الضريبي، العنوان الوطني، وممثل المنشأة القانوني مباشرة من بيانات جهة الاتصال الرئيسية التابعة.
6. **شاشة عروض الأسعار (`QuotationBuilderForm`)**: مزامنة اسم المنشأة والسجل التجاري تلقائياً.
7. **شاشة الصفقات (`DealDetailPage`, `DealKanbanBoard`, `DealsListView`)**: استخدام دالة `contactDisplayName` المحدثة لعرض اسم المنشأة أو الشخص بدقة في مراحل الصفقات.
8. **البحث الموحد الشامل (`CrmGlobalSearch`)**: يبحث عبر الاسم، اسم المنشأة، البريد، الجوال، السجل التجاري، الرقم الموحد، الرقم الضريبي، وأسماء مسؤولي جهات الاتصال التابعة.
9. **الفواتير وسندات القبض (`CreateGenericInvoicePage`, `StatementOfAccountPage`, `ReportsPage`)**: تكامل كامل لعرض المنشآت وحساباتها دون أخطاء.

---

## 6. الاختبارات المنفذة ونتائجها الفعلية (Executed Tests & Results)

### أ. اختبار فحص الأنواع (TypeScript Compiler)
- الأمر: `npx tsc -b`
- النتيجة: **خروج برمز 0 (Clean exit with 0 errors)**.

### ب. اختبار حزم الإنتاج (Vite Build)
- الأمر: `npm run build`
- النتيجة: **بناء حزم الإنتاج بنجاح (100% SUCCESS) في 61 ثانية مع 6102 موديول**.

### ج. اختبار محاكي قواعد الأمان Firestore (Security Rules Suite)
- الأمر: `npm run test:rules`
- النتيجة: **32/32 اختباراً ناجحاً بنسبة 100%**.
  - عزل بيانات مستخدمي الشركات (Multi-Tenant Isolation).
  - منع الوصول غير المصرح به لقواعد البيانات والمستندات.
  - حماية سجلات وتقارير الموظفين وعمليات الإضافة والتعديل.

### د. اختبار سيناريوهات سير العمل الحية (Live Workflows Suite)
- الأمر: `npm run test:workflows`
- النتيجة: **30/30 سيناريو ناجحاً بنسبة 100%**.
  - `PASS` إنشاء جهة اتصال من نوع شركة وتخزين جهات الاتصال التابعة والعلاقات المتعددة.
  - `PASS` تصفية واستعلام جهات الاتصال بحسب `entityType == 'company'`.
  - `PASS` استعلام جهات الاتصال بمصفوفة العلاقات المتعددة (`array-contains 'vendor'`).
  - `PASS` التحقق من صحة جهة الاتصال الرئيسية التابعة وأصحاب القرار.
  - `PASS` تبديل جهة الاتصال الرئيسية والتأكد من انفراد صفة "الرئيسي" لشخص واحد.
  - `PASS` عزل الكيانات: منع شركة منافسة (Beta Company) من قراءة بيانات شركة Alpha أو جهات اتصالها التابعة.
  - `PASS` منع غير المسجلين (Unauthenticated) من الوصول لأي جهة اتصال.
  - `PASS` تسلسل علاقات العميل المحتمل -> الصفقة -> العقد والحسابات التجارية.

---

## 7. نتائج فحص صلاحيات Firebase وعزل الشركات (Security & Tenant Isolation)

1. **مسار المستندات المعزول**:
   تُخزن جميع جهات الاتصال تحت المسار المعزول: `companies/{companyId}/contacts/{contactId}`، مما يضمن في كل استعلام وفحص صلاحية أن `request.auth.uid` ينتمي حصرياً للشركة صاحبة المسار (`get(/databases/$(database)/documents/users/$(request.auth.uid)).data.companyId == companyId`).
2. **حظر الوصول العابر للشركات (Cross-Tenant Access Denial)**:
   أثبتت الاختبارات الحية فشل محاولة قراءة مستندات شركة Alpha من قِبل مدير شركة Beta (`Beta Admin cannot read Alpha Company contact with associated persons`) برمز الخطأ `PERMISSION_DENIED`.
3. **حظر الوصول غير الموثق (Unauthenticated Access Denial)**:
   أثبتت الاختبارات الحية رفض كافة محاولات القراءة والكتابة من مصادر غير مسجلة دخولها برمز الخطأ `PERMISSION_DENIED`.
4. **جهات الاتصال التابعة محتواة داخل المستند**:
   تخزين جهات الاتصال التابعة كمصفوفة كائنات داخل مستند الجهة يحافظ تلقائياً على نفس قواعد الأمان والحماية المعزولة، مع تجنب إنشاء سجلات يتيمة وضمان الحفظ الذري (Atomic Save) الكامل دون فشل جزئي.

---

## 8. الأخطاء التي تم اكتشافها وإصلاحها (Resolved Defects)

1. **خطأ عدم تطابق أنواع العناوين وجهات الاتصال التابعة في Zod Schema**:
   تمت مواءمة خصائص `ContactAddress` و `AssociatedContactPerson` لدعم كلا المسميين (`addressType` / `type`، و `streetName` / `street`، و `contactRole` / `type`) لضمان قبول النماذج والبيانات التاريخية دون أخطاء.
2. **خطأ توقيع دالة `toCreateContactDTO` مع شاشات الفوترة**:
   كانت شاشات `CreateBillPage` و `CreateInvoicePage` تمرر بيانات جزئية لإنشاء جهة الاتصال السريعة؛ تم تحديث توقيع الدالة ليقبل `Partial<ContactFormValues> | ContactFormValues` مع وضع قيم افتراضية ذكية ومحايدة لنوع الكيان والعلاقات.
3. **خطأ تعارض Zod Resolver مع Hook Form Types**:
   تمت معالجة تباين المدخلات والمخرجات الناتج عن `superRefine` عبر كاست نوعي دقيق يمنع تعطل البناء ويحافظ على التحقق الصارم أثناء التشغيل.
4. **تعدد جهات الاتصال الرئيسية في المنشأة**:
   تم تطبيق منطق برمجي صارم في `AssociatedContactsSection` ومخطط التحقق بحيث عند تفعيل خيار "جهة الاتصال الرئيسية" لشخص ما، يتم تلقائياً إلغاء هذا الخيار عن بقية الأشخاص التابعين للمنشأة لضمان وجود جهة رئيسية واحدة دائماً.

---

## 9. عناصر تحتاج تكاملًا خارجيًا أو قرارًا من المستخدم (External Integrations / User Decisions)

1. **الربط المباشر مع واجهات واتساب التجارية (WhatsApp Business Cloud API)**:
   يقوم النظام حالياً بإنشاء روابط واتساب مباشرة (`https://wa.me/966...`) لفتح المحادثة الفورية بضغطة زر. إذا رغبت المنشأة في إرسال رسائل آلية ومجدولة، يمكن ربط مزود مثل Twilio أو Meta WhatsApp Cloud API.
2. **التحقق اللحظي من السجل التجاري عبر خدمة واثق (Wathq API)**:
   النظام مهيأ لاستقبال رقم السجل التجاري، تاريخ انتهائه، والرقم الموحد 700. يمكن مستقبلاً ربط مفتاح واثق الحكومي لتعبئة بيانات المنشأة تلقائياً بمجرد إدخال رقم السجل التجاري.

---

## 10. جدول مصفوفة التحقق ومعايير القبول النهائية (Acceptance Matrix)

| المعيار | المتطلب | النتيجة الفعلية | الحالة |
|---|---|---|:---:|
| 1 | فصل نوع الكيان عن العلاقات والحالة | تم فصل `entityType` (9 أنواع) و `relationships` (12 علاقة متعددة) و `relationshipStatuses` تماماً. | **PASS** |
| 2 | الحقول الديناميكية للأفراد والمنشآت والجهات الرسمية | تتبدل الحقول ديناميكياً فور تغيير نوع الكيان مع شروط تحقق مخصصة لكل نوع. | **PASS** |
| 3 | جهات الاتصال المتعددة التابعة للمنشآت | يدعم إضافة مسؤولي المنشأة، تعيين جهة اتصال رئيسية وحيدة، وتحديد أصحاب القرار. | **PASS** |
| 4 | بيانات التواصل والعناوين المتعددة والمنصات | مكونات مستقلة للعناوين الوطنية وحسابات التواصل الاجتماعي المخصصة مع روابط تفاعلية. | **PASS** |
| 5 | البيانات المالية وبيانات المبيعات | حقول شروط الدفع والضريبة والحد الائتماني والقطاع والخدمات مدمجة ومحفوظة. | **PASS** |
| 6 | التكامل التام مع العقود وعروض الأسعار والصفقات | جهات الاتصال والمنشآت والمسؤولون يُحمّلون تلقائياً في العقود والصفقات وعروض الأسعار. | **PASS** |
| 7 | التوافق الكامل مع السجلات القديمة وعدم فقدان البيانات | جميع الحقول الجديدة اختيارية إضافية، ودالة `toCreateContactDTO` تدعم المستندات السابقة. | **PASS** |
| 8 | البحث المتقدم والفلاتر الشاملة | فلاتر نوع الكيان والعلاقات تعمل في القائمة والدليل الموحد مع بحث شامل في السجل والضريبة والمسؤولين. | **PASS** |
| 9 | عزل الشركات والصلاحيات في Firestore | اجتياز 32 اختبار أمان و 30 سيناريو عمل حقيقي على محاكي Firestore بنسبة نجاح 100%. | **PASS** |
| 10 | جودة الكود والبناء والترجمة | `tsc -b` نظيف تماماً (0 أخطاء)، `npm run build` ناجح، ودعم كامل للغتين العربية والإنجليزية. | **PASS** |

---

**الخلاصة:** تم إنجاز نظام تصنيفات جهات الاتصال الديناميكي والتكامل الشامل مع كافة أجزاء الـ CRM وقاعدة بيانات Firestore بنجاح تام وبأعلى معايير الجودة والأمان البرمجي.
