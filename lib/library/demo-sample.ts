/**
 * The demo site's only policy template (Jeremy, 2026-10-16: "we don't want
 * to include these new templates ... so people aren't getting the good
 * stuff for free"). The real templates are for subscribers and never reach
 * the demo; visitors get this short sample instead, to see the page and
 * try the Word download. The mirror (lib/demo-mirror.ts) writes it to the
 * demo's Library after the copied items.
 */
export const DEMO_SAMPLE_TEMPLATE_ID = "6d2c7f3e-5a1b-4c8e-9f20-d3e0a1b2c4f5";

const MARKUP = `:::note This is a sample
A short example of a Library policy template. Stratasphere subscribers get the full templates, written for BC stratas.
:::

## Purpose
This policy sets out how pets are kept at [Strata Corporation name] so that owners, tenants and occupants can enjoy their homes and the common property.

## Scope
This policy applies to every owner, tenant, occupant and visitor, and to every pet kept in a strata lot or brought onto the common property.

## General Principles
All pets must:
- Be kept in line with the strata's bylaws
- Be leashed or carried on the common property
- Not cause a nuisance or unreasonable noise

Owners are responsible for their tenants' and visitors' pets.

## Reporting a Concern
Concerns should be made to council in writing, with the date, time and a description of what happened.

## Council Authority
Council will consider each concern and may respond as the bylaws allow.`;

export function demoSampleTemplate(orderIndex: number) {
  const now = "2026-10-16T00:00:00Z";
  const item = {
    kind: "policy_template",
    title: "Sample Pet Policy",
    summary: "A short sample of a policy template. Stratasphere subscribers get the full templates, ready to adapt and download.",
    tags: ["pets", "sample"],
    markup: MARKUP,
    sources: [],
  };
  return {
    id: DEMO_SAMPLE_TEMPLATE_ID,
    kind: item.kind,
    title: item.title,
    summary: item.summary,
    tags: item.tags,
    published: item,
    published_at: now,
    order_index: orderIndex,
    created_at: now,
    updated_at: now,
  };
}
