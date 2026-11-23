import { Client } from '@elastic/elasticsearch';
import { config } from '../config';
import { EmailDto, EmailStatus, getEmailsByIds, searchEmailsDb, toDto } from '../db/emailRepo';
import { chunk } from '../lib/http';

const client = config.elasticsearch.url ? new Client({ node: config.elasticsearch.url }) : null;
const index = config.elasticsearch.index;

export const searchEnabled = () => client !== null;

export async function ensureIndex(): Promise<void> {
  if (!client) {
    console.warn('[search] ELASTICSEARCH_URL not set: search falls back to Postgres');
    return;
  }
  try {
    const exists = await client.indices.exists({ index });
    if (exists) return;
    await client.indices.create({
      index,
      mappings: {
        properties: {
          id: { type: 'keyword' },
          userId: { type: 'keyword' },
          campaignId: { type: 'keyword' },
          recipient: { type: 'search_as_you_type' },
          subject: { type: 'search_as_you_type' },
          body: { type: 'text' },
          status: { type: 'keyword' },
          senderEmail: { type: 'keyword' },
          scheduledAt: { type: 'date' },
          sentAt: { type: 'date' },
          attempts: { type: 'integer' },
          error: { type: 'text' },
          previewUrl: { type: 'keyword', index: false },
        },
      },
    });
    console.log(`[search] created index "${index}"`);
  } catch (err) {
    console.error('[search] could not ensure index (search will fall back to Postgres)', err);
  }
}

/** Indexing is best-effort: Postgres is the source of truth, ES is a read model. */
export async function indexEmails(docs: EmailDto[]): Promise<void> {
  if (!client || docs.length === 0) return;
  try {
    for (const part of chunk(docs, 500)) {
      await client.bulk({ operations: part.flatMap((d) => [{ index: { _index: index, _id: d.id } }, d]) });
    }
  } catch (err) {
    console.error('[search] bulk index failed', err);
  }
}

export async function reindexEmail(id: string): Promise<void> {
  if (!client) return;
  const rows = await getEmailsByIds([id]);
  await indexEmails(rows.map(toDto));
}

export async function searchEmails(userId: string, q: string, statuses: EmailStatus[], size = 50): Promise<EmailDto[]> {
  if (!client) return searchEmailsDb(userId, q, statuses, size);
  try {
    const res = await client.search<EmailDto>({
      index,
      size,
      query: {
        bool: {
          filter: [{ term: { userId } }, { terms: { status: statuses } }],
          must: q
            ? [
                {
                  multi_match: {
                    query: q,
                    type: 'bool_prefix',
                    fields: [
                      'recipient^3', 'recipient._2gram', 'recipient._3gram',
                      'subject^2', 'subject._2gram', 'subject._3gram',
                      'body',
                    ],
                  },
                },
              ]
            : [{ match_all: {} }],
        },
      },
      sort: ['_score', { scheduledAt: 'desc' }],
    });
    return res.hits.hits.map((h) => h._source as EmailDto);
  } catch (err) {
    console.error('[search] ES query failed, falling back to Postgres', err);
    return searchEmailsDb(userId, q, statuses, size);
  }
}
