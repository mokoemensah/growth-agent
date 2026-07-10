import type { Db } from "../../apps/api/src/jobs/db.js";
import { triggerOutreach } from "./trigger-outreach.js";

export async function processApproval(
  db: Db,
  approvalId: string,
  decision: "approved" | "rejected",
): Promise<void> {
  const [approval] = await db.sql<
    {
      id: string;
      action: string;
      status: string;
      contact_id: string | null;
      campaign_id: string | null;
      payload: Record<string, unknown>;
    }[]
  >`
    SELECT id, action::text AS action, status::text AS status,
           contact_id, (payload->>'campaignId')::uuid AS campaign_id, payload
    FROM approvals WHERE id = ${approvalId}
  `;

  if (!approval || approval.status !== "pending") {
    throw new Error("Approval not found or already resolved");
  }

  await db.sql`
    UPDATE approvals SET
      status = ${decision}::approval_status,
      resolved_by = 'dashboard',
      resolved_at = now()
    WHERE id = ${approvalId}
  `;

  await db.activities.create({
    contactId: approval.contact_id ?? undefined,
    type: decision === "approved" ? "approval_granted" : "approval_rejected",
    agentId: "dashboard",
    metadata: { approvalId, action: approval.action },
  });

  if (decision !== "approved" || approval.action !== "send_email" || !approval.contact_id) {
    return;
  }

  const campaignId =
    approval.campaign_id ??
    process.env.DEFAULT_CAMPAIGN_ID ??
    "11111111-1111-1111-1111-111111111111";

  await db.contacts.update(approval.contact_id, { status: "queued" });
  await db.campaignContacts.enroll(campaignId, approval.contact_id);

  await triggerOutreach(db, {
    source: "approval",
    batchSize: 1,
    contactIds: [approval.contact_id],
    campaignId,
    triggerId: approvalId,
  });
}
