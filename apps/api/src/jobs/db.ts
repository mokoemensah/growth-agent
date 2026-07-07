import postgres, { type JSONValue } from "postgres";
import type { PolicyContext } from "../../../../packages/policies/index.js";
import type {
  ActivityType,
  Campaign,
  CampaignEnrollment,
  Company,
  Contact,
  ContactStatus,
  EmailMessage,
  InboundReply,
  JobEnqueueInput,
  PendingJob,
  Product,
  SequenceStep,
} from "./types.js";

type Sql = ReturnType<typeof postgres>;

export interface Db {
  sql: Sql;
  companies: CompaniesRepo;
  contacts: ContactsRepo;
  campaigns: CampaignsRepo;
  products: ProductsRepo;
  sequences: SequencesRepo;
  campaignContacts: CampaignContactsRepo;
  activities: ActivitiesRepo;
  emailMessages: EmailMessagesRepo;
  inboundQueue: InboundQueueRepo;
  jobs: JobsRepo;
  approvals: ApprovalsRepo;
  suppression: SuppressionRepo;
  policy: PolicyRepo;
  metrics: MetricsRepo;
  auditLog: AuditLogRepo;
}

interface CompaniesRepo {
  get(id: string): Promise<Company>;
  upsertByDomain(input: UpsertCompanyInput): Promise<Company>;
  update(id: string, patch: Partial<UpsertCompanyInput & CompanyScorePatch>): Promise<void>;
  findByIds(ids: string[]): Promise<Company[]>;
  findUnscored(opts: { limit: number }): Promise<Company[]>;
}

interface ContactsRepo {
  get(id: string): Promise<Contact>;
  upsertByEmail(input: UpsertContactInput): Promise<Contact>;
  update(id: string, patch: Partial<ContactPatch>): Promise<void>;
  findByCompany(companyId: string): Promise<Contact[]>;
  findByEmail(email: string): Promise<Contact | null>;
  findQueuedForCampaign(campaignId: string, limit: number): Promise<Contact[]>;
  findQueuedByIds(campaignId: string, contactIds: string[]): Promise<Contact[]>;
}

interface CampaignsRepo {
  get(id: string): Promise<Campaign>;
  getByProductId(productId: string): Promise<Campaign | null>;
  listActive(): Promise<Campaign[]>;
  incrementSent(id: string): Promise<void>;
}

interface ProductsRepo {
  get(id: string): Promise<Product>;
  getBySlug(slug: string): Promise<Product | null>;
  list(opts?: { status?: Product["status"][] }): Promise<Product[]>;
  listActive(): Promise<Product[]>;
  updateStatus(id: string, status: Product["status"]): Promise<void>;
  updateLaymanPitch(id: string, laymanPitch: string | null): Promise<void>;
  updateCacAssumptions(id: string, assumptions: Record<string, unknown>): Promise<void>;
  updateIntelligence(id: string, intelligence: Record<string, unknown>): Promise<void>;
  delete(id: string): Promise<void>;
  upsertFromCatalog(input: CatalogProductInput): Promise<Product>;
}

interface SequencesRepo {
  getStep(campaignId: string, stepNumber: number): Promise<SequenceStep>;
}

interface CampaignContactsRepo {
  enroll(campaignId: string, contactId: string): Promise<void>;
  get(campaignId: string, contactId: string): Promise<CampaignEnrollment>;
  advanceStep(campaignId: string, contactId: string): Promise<void>;
}

interface ActivitiesRepo {
  create(input: CreateActivityInput): Promise<void>;
}

interface EmailMessagesRepo {
  create(input: CreateEmailInput): Promise<EmailMessage>;
  findByProviderId(providerId: string): Promise<EmailMessage | null>;
  findThread(threadId: string | null): Promise<EmailMessage[]>;
}

interface InboundQueueRepo {
  enqueue(input: InboundQueueInput): Promise<void>;
  fetchUnprocessed(since: Date, limit: number): Promise<InboundReply[]>;
  markProcessed(providerId: string): Promise<void>;
}

interface JobsRepo {
  enqueue(input: JobEnqueueInput): Promise<string>;
  fetchDue(limit: number): Promise<PendingJob[]>;
  markRunning(id: string): Promise<void>;
  markCompleted(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}

interface ApprovalsRepo {
  create(input: CreateApprovalInput): Promise<string>;
  countPending(): Promise<number>;
}

interface SuppressionRepo {
  hasDomain(domain: string): Promise<boolean>;
  add(email: string, reason: string): Promise<void>;
}

interface PolicyRepo {
  getContext(): Promise<PolicyContext>;
}

interface MetricsRepo {
  getDaily(day: Date): Promise<DailyMetrics>;
  getPipelineSummary(): Promise<PipelineRow[]>;
}

interface AuditLogRepo {
  create(input: CreateAuditInput): Promise<void>;
}

interface UpsertCompanyInput {
  name: string;
  domain: string;
  industry?: string | null;
  employeeCount?: number | null;
  country?: string | null;
  source?: string;
  sourceRef?: string | null;
}

interface CompanyScorePatch {
  description?: string | null;
  linkedinUrl?: string | null;
  industry?: string | null;
  employeeCount?: number | null;
  icpScore?: number;
  icpReason?: string;
  disqualified?: boolean;
  disqualifyReason?: string;
  metadata?: Record<string, unknown>;
}

interface UpsertContactInput {
  companyId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
  status?: ContactStatus;
}

interface ContactPatch {
  status?: ContactStatus;
  leadScore?: number;
  leadScoreReason?: string;
  productId?: string | null;
  doNotContact?: boolean;
  unsubscribedAt?: Date;
  lastContactedAt?: Date;
}

interface CatalogProductInput {
  slug: string;
  name: string;
  repo?: string | null;
  description?: string | null;
  laymanPitch?: string | null;
  status?: Product["status"];
}

interface CreateActivityInput {
  companyId?: string;
  contactId?: string;
  campaignId?: string;
  productId?: string;
  type: ActivityType;
  channel?: string;
  subject?: string;
  body?: string;
  externalId?: string;
  agentId?: string;
  jobId?: string;
  metadata?: Record<string, unknown>;
}

interface CreateEmailInput {
  contactId: string;
  campaignId?: string;
  sequenceStep?: number;
  direction: "outbound" | "inbound";
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  providerId?: string;
  threadId?: string | null;
  repliedAt?: Date;
  variantId?: string;
}

interface InboundQueueInput {
  fromEmail: string;
  toEmail?: string;
  subject: string;
  bodyText: string;
  providerId: string;
  threadId?: string | null;
  campaignId?: string | null;
  contactId?: string | null;
}

interface CreateApprovalInput {
  action: string;
  agentId: string;
  contactId?: string;
  companyId?: string;
  payload: Record<string, unknown>;
  reason: string;
}

interface CreateAuditInput {
  agentId: string;
  action: string;
  entityType?: string;
  entityId?: string;
  input?: unknown;
  output?: unknown;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  jobId?: string;
  policyDecision?: string;
}

interface DailyMetrics {
  emailsSent: number;
  replies: number;
  meetingsBooked: number;
  policyBlocks: number;
  costUsd: number;
}

interface PipelineRow {
  status: string;
  count: number;
}

function mapCompany(row: CompanyRow): Company {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    industry: row.industry,
    employeeCount: row.employee_count,
    country: row.country,
    linkedinUrl: row.linkedin_url,
    description: row.description,
    icpScore: row.icp_score,
    icpReason: row.icp_reason,
    disqualified: row.disqualified,
    disqualifyReason: row.disqualify_reason,
    source: row.source,
    sourceRef: row.source_ref,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapContact(row: ContactRow): Contact {
  return {
    id: row.id,
    companyId: row.company_id,
    productId: row.product_id ?? null,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    title: row.title,
    status: row.status as ContactStatus,
    leadScore: row.lead_score,
    leadScoreReason: row.lead_score_reason,
    doNotContact: row.do_not_contact,
    unsubscribedAt: row.unsubscribed_at,
    lastContactedAt: row.last_contacted_at,
    lastRepliedAt: row.last_replied_at,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCampaign(row: {
  id: string;
  name: string;
  slug: string;
  channel: string;
  playbook_id: string;
  product_id: string | null;
  status: Campaign["status"];
  daily_send_cap: number;
  total_sent: number;
}): Campaign {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    channel: row.channel,
    playbookId: row.playbook_id,
    productId: row.product_id,
    status: row.status,
    dailySendCap: row.daily_send_cap,
    totalSent: row.total_sent,
  };
}

interface ProductRow {
  id: string;
  slug: string;
  name: string;
  repo: string | null;
  description: string | null;
  layman_pitch: string | null;
  status: Product["status"];
  landing_path: string | null;
  price_cents: number | null;
  billing: string | null;
  icp_rules: unknown;
  metadata: unknown;
  created_at: Date;
  updated_at: Date;
}

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    repo: row.repo,
    description: row.description,
    laymanPitch: row.layman_pitch,
    status: row.status,
    landingPath: row.landing_path,
    priceCents: row.price_cents,
    billing: row.billing,
    icpRules: (row.icp_rules ?? {}) as Record<string, unknown>,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface CompanyRow {
  id: string;
  name: string;
  domain: string;
  industry: string | null;
  employee_count: number | null;
  country: string | null;
  linkedin_url: string | null;
  description: string | null;
  icp_score: number | null;
  icp_reason: string | null;
  disqualified: boolean;
  disqualify_reason: string | null;
  source: string;
  source_ref: string | null;
  metadata: unknown;
  created_at: Date;
  updated_at: Date;
}

interface ContactRow {
  id: string;
  company_id: string;
  product_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  status: string;
  lead_score: number | null;
  lead_score_reason: string | null;
  do_not_contact: boolean;
  unsubscribed_at: Date | null;
  last_contacted_at: Date | null;
  last_replied_at: Date | null;
  metadata: unknown;
  created_at: Date;
  updated_at: Date;
}

export function createDb(databaseUrl: string): Db {
  const sql = postgres(databaseUrl, {
    ssl: databaseUrl.includes("neon.tech") ? "require" : undefined,
    transform: { undefined: null },
  });

  const companies: CompaniesRepo = {
    async get(id) {
      const [row] = await sql<CompanyRow[]>`
        SELECT * FROM companies WHERE id = ${id}
      `;
      if (!row) throw new Error(`Company not found: ${id}`);
      return mapCompany(row);
    },

    async upsertByDomain(input) {
      const [row] = await sql<CompanyRow[]>`
        INSERT INTO companies (name, domain, industry, employee_count, country, source, source_ref)
        VALUES (
          ${input.name},
          ${input.domain},
          ${input.industry ?? null},
          ${input.employeeCount ?? null},
          ${input.country ?? null},
          ${input.source ?? "manual"},
          ${input.sourceRef ?? null}
        )
        ON CONFLICT (domain) DO UPDATE SET
          name = EXCLUDED.name,
          industry = COALESCE(EXCLUDED.industry, companies.industry),
          employee_count = COALESCE(EXCLUDED.employee_count, companies.employee_count),
          country = COALESCE(EXCLUDED.country, companies.country),
          source_ref = COALESCE(EXCLUDED.source_ref, companies.source_ref),
          updated_at = now()
        RETURNING *
      `;
      return mapCompany(row);
    },

    async update(id, patch) {
      const existing = await companies.get(id);
      const metadata =
        patch.metadata !== undefined
          ? { ...existing.metadata, ...patch.metadata }
          : undefined;

      await sql`
        UPDATE companies SET
          description = COALESCE(${patch.description ?? null}, description),
          linkedin_url = COALESCE(${patch.linkedinUrl ?? null}, linkedin_url),
          industry = COALESCE(${patch.industry ?? null}, industry),
          employee_count = COALESCE(${patch.employeeCount ?? null}, employee_count),
          icp_score = COALESCE(${patch.icpScore ?? null}, icp_score),
          icp_reason = COALESCE(${patch.icpReason ?? null}, icp_reason),
          disqualified = COALESCE(${patch.disqualified ?? null}, disqualified),
          disqualify_reason = COALESCE(${patch.disqualifyReason ?? null}, disqualify_reason),
          metadata = COALESCE(${metadata ? sql.json(metadata as JSONValue) : null}, metadata),
          updated_at = now()
        WHERE id = ${id}
      `;
    },

    async findByIds(ids) {
      if (ids.length === 0) return [];
      const rows = await sql<CompanyRow[]>`
        SELECT * FROM companies WHERE id = ANY(${ids}::uuid[])
      `;
      return rows.map(mapCompany);
    },

    async findUnscored({ limit }) {
      const rows = await sql<CompanyRow[]>`
        SELECT * FROM companies
        WHERE icp_score IS NULL AND NOT disqualified
        ORDER BY created_at ASC
        LIMIT ${limit}
      `;
      return rows.map(mapCompany);
    },
  };

  const contacts: ContactsRepo = {
    async get(id) {
      const [row] = await sql<ContactRow[]>`
        SELECT * FROM contacts WHERE id = ${id}
      `;
      if (!row) throw new Error(`Contact not found: ${id}`);
      return mapContact(row);
    },

    async upsertByEmail(input) {
      const [row] = await sql<ContactRow[]>`
        INSERT INTO contacts (company_id, email, first_name, last_name, title, status)
        VALUES (
          ${input.companyId},
          ${input.email},
          ${input.firstName ?? null},
          ${input.lastName ?? null},
          ${input.title ?? null},
          ${input.status ?? "new"}
        )
        ON CONFLICT (email) DO UPDATE SET
          first_name = COALESCE(EXCLUDED.first_name, contacts.first_name),
          last_name = COALESCE(EXCLUDED.last_name, contacts.last_name),
          title = COALESCE(EXCLUDED.title, contacts.title),
          status = CASE
            WHEN contacts.status IN ('contacted', 'replied', 'interested', 'won', 'lost')
            THEN contacts.status
            ELSE EXCLUDED.status
          END,
          updated_at = now()
        RETURNING *
      `;
      return mapContact(row);
    },

    async update(id, patch) {
      await sql`
        UPDATE contacts SET
          status = COALESCE(${patch.status ?? null}, status),
          lead_score = COALESCE(${patch.leadScore ?? null}, lead_score),
          lead_score_reason = COALESCE(${patch.leadScoreReason ?? null}, lead_score_reason),
          product_id = COALESCE(${patch.productId ?? null}, product_id),
          do_not_contact = COALESCE(${patch.doNotContact ?? null}, do_not_contact),
          unsubscribed_at = COALESCE(${patch.unsubscribedAt ?? null}, unsubscribed_at),
          last_contacted_at = COALESCE(${patch.lastContactedAt ?? null}, last_contacted_at),
          updated_at = now()
        WHERE id = ${id}
      `;
    },

    async findByCompany(companyId) {
      const rows = await sql<ContactRow[]>`
        SELECT * FROM contacts WHERE company_id = ${companyId}
        ORDER BY created_at ASC
      `;
      return rows.map(mapContact);
    },

    async findByEmail(email) {
      const [row] = await sql<ContactRow[]>`
        SELECT * FROM contacts WHERE email = ${email.toLowerCase()}
      `;
      return row ? mapContact(row) : null;
    },

    async findQueuedForCampaign(campaignId, limit) {
      const rows = await sql<ContactRow[]>`
        SELECT c.* FROM contacts c
        INNER JOIN campaign_contacts cc ON cc.contact_id = c.id
        WHERE cc.campaign_id = ${campaignId}
          AND c.status = 'queued'
          AND NOT c.do_not_contact
          AND cc.completed_at IS NULL
        ORDER BY cc.enrolled_at ASC
        LIMIT ${limit}
      `;
      return rows.map(mapContact);
    },

    async findQueuedByIds(campaignId, contactIds) {
      if (contactIds.length === 0) return [];
      const rows = await sql<ContactRow[]>`
        SELECT c.* FROM contacts c
        INNER JOIN campaign_contacts cc ON cc.contact_id = c.id
        WHERE cc.campaign_id = ${campaignId}
          AND c.id = ANY(${contactIds}::uuid[])
          AND c.status = 'queued'
          AND NOT c.do_not_contact
      `;
      return rows.map(mapContact);
    },
  };

  const campaigns: CampaignsRepo = {
    async get(id) {
      const [row] = await sql<
        {
          id: string;
          name: string;
          slug: string;
          channel: string;
          playbook_id: string;
          product_id: string | null;
          status: Campaign["status"];
          daily_send_cap: number;
          total_sent: number;
        }[]
      >`SELECT * FROM campaigns WHERE id = ${id}`;
      if (!row) throw new Error(`Campaign not found: ${id}`);
      return mapCampaign(row);
    },

    async getByProductId(productId) {
      const [row] = await sql<
        {
          id: string;
          name: string;
          slug: string;
          channel: string;
          playbook_id: string;
          product_id: string | null;
          status: Campaign["status"];
          daily_send_cap: number;
          total_sent: number;
        }[]
      >`
        SELECT * FROM campaigns
        WHERE product_id = ${productId} AND status = 'active'
        ORDER BY created_at ASC
        LIMIT 1
      `;
      return row ? mapCampaign(row) : null;
    },

    async listActive() {
      const rows = await sql<
        {
          id: string;
          name: string;
          slug: string;
          channel: string;
          playbook_id: string;
          product_id: string | null;
          status: Campaign["status"];
          daily_send_cap: number;
          total_sent: number;
        }[]
      >`SELECT * FROM campaigns WHERE status = 'active'`;
      return rows.map(mapCampaign);
    },

    async incrementSent(id) {
      await sql`UPDATE campaigns SET total_sent = total_sent + 1, updated_at = now() WHERE id = ${id}`;
    },
  };

  const products: ProductsRepo = {
    async get(id) {
      const [row] = await sql<ProductRow[]>`
        SELECT * FROM products WHERE id = ${id}
      `;
      if (!row) throw new Error(`Product not found: ${id}`);
      return mapProduct(row);
    },

    async getBySlug(slug) {
      const [row] = await sql<ProductRow[]>`
        SELECT * FROM products WHERE slug = ${slug}
      `;
      return row ? mapProduct(row) : null;
    },

    async list(opts) {
      const statuses = opts?.status;
      const rows = statuses?.length
        ? await sql<ProductRow[]>`
            SELECT * FROM products WHERE status = ANY(${statuses}::product_status[])
            ORDER BY name ASC
          `
        : await sql<ProductRow[]>`SELECT * FROM products ORDER BY name ASC`;
      return rows.map(mapProduct);
    },

    async listActive() {
      const rows = await sql<ProductRow[]>`
        SELECT * FROM products WHERE status IN ('active', 'beta')
        ORDER BY name ASC
      `;
      return rows.map(mapProduct);
    },

    async updateStatus(id, status) {
      await sql`
        UPDATE products SET status = ${status}::product_status, updated_at = now()
        WHERE id = ${id}
      `;
    },

    async updateLaymanPitch(id, laymanPitch) {
      await sql`
        UPDATE products SET layman_pitch = ${laymanPitch}, updated_at = now()
        WHERE id = ${id}
      `;
    },

    async updateCacAssumptions(id, assumptions) {
      const product = await products.get(id);
      const cac = {
        ...((product.metadata.cac as Record<string, unknown> | undefined) ?? {}),
        ...assumptions,
      };
      const metadata = { ...product.metadata, cac };
      await sql`
        UPDATE products SET metadata = ${sql.json(metadata as JSONValue)}, updated_at = now()
        WHERE id = ${id}
      `;
    },

    async updateIntelligence(id, intelligence) {
      const product = await products.get(id);
      const metadata = { ...product.metadata, intelligence };
      await sql`
        UPDATE products SET metadata = ${sql.json(metadata as JSONValue)}, updated_at = now()
        WHERE id = ${id}
      `;
    },

    async delete(id) {
      await sql`DELETE FROM products WHERE id = ${id}`;
    },

    async upsertFromCatalog(input) {
      const slug = input.slug;
      const [row] = await sql<ProductRow[]>`
        INSERT INTO products (slug, name, repo, description, layman_pitch, status, landing_path)
        VALUES (
          ${slug},
          ${input.name},
          ${input.repo ?? null},
          ${input.description ?? null},
          ${input.laymanPitch ?? null},
          ${input.status ?? "paused"}::product_status,
          ${`/p/${slug}`}
        )
        ON CONFLICT (slug) DO UPDATE SET
          name = products.name,
          repo = COALESCE(EXCLUDED.repo, products.repo),
          description = COALESCE(EXCLUDED.description, products.description),
          layman_pitch = COALESCE(products.layman_pitch, EXCLUDED.layman_pitch),
          updated_at = now()
        RETURNING *
      `;
      return mapProduct(row);
    },
  };

  const sequences: SequencesRepo = {
    async getStep(campaignId, stepNumber) {
      const [row] = await sql<
        {
          id: string;
          campaign_id: string;
          step_number: number;
          delay_days: number;
          subject_template: string;
          body_template: string;
        }[]
      >`
        SELECT * FROM sequences
        WHERE campaign_id = ${campaignId} AND step_number = ${stepNumber}
      `;
      if (!row) throw new Error(`Sequence step not found: ${campaignId}/${stepNumber}`);
      return {
        id: row.id,
        campaignId: row.campaign_id,
        stepNumber: row.step_number,
        delayDays: row.delay_days,
        subjectTemplate: row.subject_template,
        bodyTemplate: row.body_template,
      };
    },
  };

  const campaignContacts: CampaignContactsRepo = {
    async enroll(campaignId, contactId) {
      await sql`
        INSERT INTO campaign_contacts (campaign_id, contact_id, sequence_step)
        VALUES (${campaignId}, ${contactId}, 0)
        ON CONFLICT (campaign_id, contact_id) DO NOTHING
      `;
    },

    async get(campaignId, contactId) {
      const [row] = await sql<{ campaign_id: string; contact_id: string; sequence_step: number }[]>`
        SELECT * FROM campaign_contacts
        WHERE campaign_id = ${campaignId} AND contact_id = ${contactId}
      `;
      if (!row) throw new Error(`Enrollment not found: ${campaignId}/${contactId}`);
      return {
        campaignId: row.campaign_id,
        contactId: row.contact_id,
        sequenceStep: row.sequence_step,
      };
    },

    async advanceStep(campaignId, contactId) {
      const enrollment = await campaignContacts.get(campaignId, contactId);
      const nextStep = enrollment.sequenceStep + 1;
      const [next] = await sql<{ step_number: number }[]>`
        SELECT step_number FROM sequences
        WHERE campaign_id = ${campaignId} AND step_number = ${nextStep}
      `;

      if (next) {
        await sql`
          UPDATE campaign_contacts SET sequence_step = ${nextStep}
          WHERE campaign_id = ${campaignId} AND contact_id = ${contactId}
        `;
        await contacts.update(contactId, { status: "queued" });
      } else {
        await sql`
          UPDATE campaign_contacts SET completed_at = now()
          WHERE campaign_id = ${campaignId} AND contact_id = ${contactId}
        `;
      }
    },
  };

  const activities: ActivitiesRepo = {
    async create(input) {
      await sql`
        INSERT INTO activities (
          contact_id, company_id, campaign_id, product_id, type, channel,
          subject, body, external_id, agent_id, job_id, metadata
        ) VALUES (
          ${input.contactId ?? null},
          ${input.companyId ?? null},
          ${input.campaignId ?? null},
          ${input.productId ?? null},
          ${input.type},
          ${input.channel ?? null},
          ${input.subject ?? null},
          ${input.body ?? null},
          ${input.externalId ?? null},
          ${input.agentId ?? null},
          ${input.jobId ?? null},
          ${sql.json((input.metadata ?? {}) as JSONValue)}
        )
      `;
    },
  };

  const emailMessages: EmailMessagesRepo = {
    async create(input) {
      const [row] = await sql<
        {
          id: string;
          contact_id: string;
          campaign_id: string | null;
          sequence_step: number | null;
          direction: string;
          subject: string;
          body_text: string;
          provider_id: string | null;
          thread_id: string | null;
        }[]
      >`
        INSERT INTO email_messages (
          contact_id, campaign_id, sequence_step, direction,
          subject, body_text, body_html, provider_id, thread_id, variant_id, replied_at, sent_at
        ) VALUES (
          ${input.contactId},
          ${input.campaignId ?? null},
          ${input.sequenceStep ?? null},
          ${input.direction},
          ${input.subject},
          ${input.bodyText},
          ${input.bodyHtml ?? null},
          ${input.providerId ?? null},
          ${input.threadId ?? null},
          ${input.variantId ?? null},
          ${input.repliedAt ?? null},
          ${input.direction === "outbound" ? new Date() : null}
        )
        RETURNING id, contact_id, campaign_id, sequence_step, direction, subject, body_text, provider_id, thread_id
      `;
      return {
        id: row.id,
        contactId: row.contact_id,
        campaignId: row.campaign_id,
        sequenceStep: row.sequence_step,
        direction: row.direction as "outbound" | "inbound",
        subject: row.subject,
        bodyText: row.body_text,
        providerId: row.provider_id,
        threadId: row.thread_id,
      };
    },

    async findByProviderId(providerId) {
      const [row] = await sql<
        {
          id: string;
          contact_id: string;
          campaign_id: string | null;
          sequence_step: number | null;
          direction: string;
          subject: string;
          body_text: string;
          provider_id: string | null;
          thread_id: string | null;
        }[]
      >`
        SELECT id, contact_id, campaign_id, sequence_step, direction, subject, body_text, provider_id, thread_id
        FROM email_messages WHERE provider_id = ${providerId}
      `;
      if (!row) return null;
      return {
        id: row.id,
        contactId: row.contact_id,
        campaignId: row.campaign_id,
        sequenceStep: row.sequence_step,
        direction: row.direction as "outbound" | "inbound",
        subject: row.subject,
        bodyText: row.body_text,
        providerId: row.provider_id,
        threadId: row.thread_id,
      };
    },

    async findThread(threadId) {
      if (!threadId) return [];
      const rows = await sql<
        {
          id: string;
          contact_id: string;
          campaign_id: string | null;
          sequence_step: number | null;
          direction: string;
          subject: string;
          body_text: string;
          provider_id: string | null;
          thread_id: string | null;
        }[]
      >`
        SELECT id, contact_id, campaign_id, sequence_step, direction, subject, body_text, provider_id, thread_id
        FROM email_messages
        WHERE thread_id = ${threadId}
        ORDER BY created_at ASC
      `;
      return rows.map((row) => ({
        id: row.id,
        contactId: row.contact_id,
        campaignId: row.campaign_id,
        sequenceStep: row.sequence_step,
        direction: row.direction as "outbound" | "inbound",
        subject: row.subject,
        bodyText: row.body_text,
        providerId: row.provider_id,
        threadId: row.thread_id,
      }));
    },
  };

  const inboundQueue: InboundQueueRepo = {
    async enqueue(input) {
      await sql`
        INSERT INTO inbound_email_queue (
          from_email, to_email, subject, body_text, provider_id, thread_id, campaign_id, contact_id
        ) VALUES (
          ${input.fromEmail},
          ${input.toEmail ?? null},
          ${input.subject},
          ${input.bodyText},
          ${input.providerId},
          ${input.threadId ?? null},
          ${input.campaignId ?? null},
          ${input.contactId ?? null}
        )
        ON CONFLICT (provider_id) DO NOTHING
      `;
    },

    async fetchUnprocessed(since, limit) {
      const rows = await sql<
        {
          from_email: string;
          subject: string;
          body_text: string;
          provider_id: string;
          thread_id: string | null;
          campaign_id: string | null;
        }[]
      >`
        SELECT from_email, subject, body_text, provider_id, thread_id, campaign_id
        FROM inbound_email_queue
        WHERE processed_at IS NULL AND received_at >= ${since}
        ORDER BY received_at ASC
        LIMIT ${limit}
      `;
      return rows.map((row) => ({
        fromEmail: row.from_email,
        subject: row.subject,
        bodyText: row.body_text,
        providerId: row.provider_id,
        threadId: row.thread_id,
        campaignId: row.campaign_id,
      }));
    },

    async markProcessed(providerId) {
      await sql`
        UPDATE inbound_email_queue SET processed_at = now()
        WHERE provider_id = ${providerId}
      `;
    },
  };

  const jobs: JobsRepo = {
    async enqueue(input) {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO jobs (job_type, payload, idempotency_key, scheduled_for)
        VALUES (
          ${input.jobType},
          ${sql.json(input.payload as JSONValue)},
          ${input.idempotencyKey ?? null},
          ${input.scheduledFor ?? new Date()}
        )
        ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
        RETURNING id
      `;
      return row.id;
    },

    async fetchDue(limit) {
      const rows = await sql<
        { id: string; job_type: string; payload: unknown; idempotency_key: string | null }[]
      >`
        SELECT id, job_type, payload, idempotency_key FROM jobs
        WHERE status = 'pending' AND scheduled_for <= now()
        ORDER BY scheduled_for ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;
      return rows.map((row) => ({
        id: row.id,
        jobType: row.job_type,
        payload: row.payload,
        idempotencyKey: row.idempotency_key,
      }));
    },

    async markRunning(id) {
      await sql`
        UPDATE jobs SET status = 'running', started_at = COALESCE(started_at, now()), attempts = attempts + 1
        WHERE id = ${id}
      `;
    },

    async markCompleted(id) {
      await sql`
        UPDATE jobs SET status = 'completed', completed_at = now()
        WHERE id = ${id}
      `;
    },

    async markFailed(id, error) {
      await sql`
        UPDATE jobs SET
          status = CASE WHEN attempts >= max_attempts THEN 'dead_letter'::job_status ELSE 'failed'::job_status END,
          error = ${error},
          completed_at = now()
        WHERE id = ${id}
      `;
    },
  };

  const approvals: ApprovalsRepo = {
    async create(input) {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO approvals (action, agent_id, contact_id, company_id, payload, reason)
        VALUES (
          ${input.action}::approval_action,
          ${input.agentId},
          ${input.contactId ?? null},
          ${input.companyId ?? null},
          ${sql.json(input.payload as JSONValue)},
          ${input.reason}
        )
        RETURNING id
      `;
      return row.id;
    },

    async countPending() {
      const [row] = await sql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM approvals WHERE status = 'pending'
      `;
      return Number(row.count);
    },
  };

  const suppression: SuppressionRepo = {
    async hasDomain(domain) {
      const [row] = await sql<{ exists: boolean }[]>`
        SELECT EXISTS(
          SELECT 1 FROM suppression_list WHERE email LIKE ${"%@" + domain.toLowerCase()}
        ) AS exists
      `;
      return row.exists;
    },

    async add(email, reason) {
      await sql`
        INSERT INTO suppression_list (email, reason, source)
        VALUES (${email.toLowerCase()}, ${reason}, 'system')
        ON CONFLICT (email) DO NOTHING
      `;
    },
  };

  const policy: PolicyRepo = {
    async getContext() {
      const today = new Date().toISOString().slice(0, 10);

      const [emailCount] = await sql<{ count: string }[]>`
        SELECT COALESCE(count, 0)::text AS count FROM daily_counters
        WHERE counter_date = ${today}::date AND counter_key = 'emails_sent'
      `;

      const [spend] = await sql<{ total: string }[]>`
        SELECT COALESCE(SUM(cost_usd), 0)::text AS total FROM audit_log
        WHERE created_at >= ${today}::date
      `;

      const rateCards = await sql<{ id: string }[]>`SELECT id FROM rate_card WHERE active = TRUE`;

      return {
        emailsSentToday: Number(emailCount?.count ?? 0),
        spendTodayUsd: Number(spend?.total ?? 0),
        isSuppressed: false,
        isUnsubscribed: false,
        isDoNotContact: false,
        rateCardIds: new Set(rateCards.map((r) => r.id)),
        requiresApprovalForHighValue: true,
      };
    },
  };

  const metrics: MetricsRepo = {
    async getDaily(day) {
      const dayStr = day.toISOString().slice(0, 10);
      const [row] = await sql<
        {
          emails_sent: string;
          replies: string;
          meetings_booked: string;
          policy_blocks: string;
          cost_usd: string;
        }[]
      >`
        SELECT
          COUNT(*) FILTER (WHERE type = 'email_sent')::text AS emails_sent,
          COUNT(*) FILTER (WHERE type = 'email_replied')::text AS replies,
          COUNT(*) FILTER (WHERE type = 'meeting_booked')::text AS meetings_booked,
          COUNT(*) FILTER (WHERE type = 'policy_blocked')::text AS policy_blocks,
          COALESCE((
            SELECT SUM(cost_usd) FROM audit_log WHERE created_at::date = ${dayStr}::date
          ), 0)::text AS cost_usd
        FROM activities
        WHERE occurred_at::date = ${dayStr}::date
      `;
      return {
        emailsSent: Number(row?.emails_sent ?? 0),
        replies: Number(row?.replies ?? 0),
        meetingsBooked: Number(row?.meetings_booked ?? 0),
        policyBlocks: Number(row?.policy_blocks ?? 0),
        costUsd: Number(row?.cost_usd ?? 0),
      };
    },

    async getPipelineSummary() {
      const rows = await sql<{ status: string; count: string }[]>`
        SELECT status, COUNT(*)::text AS count
        FROM contacts WHERE NOT do_not_contact
        GROUP BY status ORDER BY count DESC
      `;
      return rows.map((r) => ({ status: r.status, count: Number(r.count) }));
    },
  };

  const auditLog: AuditLogRepo = {
    async create(input) {
      await sql`
        INSERT INTO audit_log (
          agent_id, action, entity_type, entity_id, input, output,
          model, prompt_tokens, completion_tokens, cost_usd, latency_ms, job_id, policy_decision
        ) VALUES (
          ${input.agentId},
          ${input.action},
          ${input.entityType ?? null},
          ${input.entityId ?? null},
          ${input.input ? sql.json(input.input as JSONValue) : null},
          ${input.output ? sql.json(input.output as JSONValue) : null},
          ${input.model ?? null},
          ${input.promptTokens ?? null},
          ${input.completionTokens ?? null},
          ${input.costUsd ?? null},
          ${input.latencyMs ?? null},
          ${input.jobId ?? null},
          ${input.policyDecision ?? null}
        )
      `;
    },
  };

  return {
    sql,
    companies,
    contacts,
    campaigns,
    products,
    sequences,
    campaignContacts,
    activities,
    emailMessages,
    inboundQueue,
    jobs,
    approvals,
    suppression,
    policy,
    metrics,
    auditLog,
  };
}

export async function incrementDailyEmailCounter(db: Db): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await db.sql`
    INSERT INTO daily_counters (counter_date, counter_key, count)
    VALUES (${today}::date, 'emails_sent', 1)
    ON CONFLICT (counter_date, counter_key)
    DO UPDATE SET count = daily_counters.count + 1
  `;
}
