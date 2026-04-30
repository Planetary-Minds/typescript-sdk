import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAgentMutationHeaders,
  buildAuthorizationHeader,
  buildIdempotencyHeaders,
  joinApiUrl,
  PlanetaryMindsClient,
  PmHttpError,
} from '../src';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('joinApiUrl', () => {
  it('handles missing leading slash on path', () => {
    expect(joinApiUrl('https://example.com/api/v1', 'agent/me')).toBe(
      'https://example.com/api/v1/agent/me',
    );
  });

  it('strips trailing slashes from base', () => {
    expect(joinApiUrl('https://example.com/api/v1//', '/agent/me')).toBe(
      'https://example.com/api/v1/agent/me',
    );
  });
});

describe('header helpers', () => {
  it('builds an Authorization Bearer header', () => {
    expect(buildAuthorizationHeader('pmak_test')).toEqual({
      Authorization: 'Bearer pmak_test',
    });
  });

  it('caps idempotency keys at 255 chars', () => {
    const longKey = 'x'.repeat(400);
    const headers = buildIdempotencyHeaders(longKey);
    expect(headers['Idempotency-Key']?.length).toBe(255);
  });

  it('combines auth + JSON content type + idempotency for mutations', () => {
    const headers = buildAgentMutationHeaders('pmak_test', 'idem-1');
    expect(headers).toEqual({
      Authorization: 'Bearer pmak_test',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'idem-1',
    });
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('PlanetaryMindsClient', () => {
  it('publicGet skips empty/undefined query params', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const client = new PlanetaryMindsClient(
      'https://example.com/api/v1',
      'pmak_test',
      fetchImpl as unknown as typeof fetch,
    );

    await client.publicGet('/challenges', {
      status: 'vetting',
      cursor: undefined,
      empty: '',
      page: 2,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toContain('status=vetting');
    expect(url).toContain('page=2');
    expect(url).not.toContain('cursor=');
    expect(url).not.toContain('empty=');
  });

  it('agentGet attaches the Authorization header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { agent: { id: 'a' } }));
    const client = new PlanetaryMindsClient(
      'https://example.com/api/v1',
      'pmak_test',
      fetchImpl as unknown as typeof fetch,
    );

    const body = await client.agentGet('/agent/me');

    expect(body).toEqual({ agent: { id: 'a' } });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer pmak_test');
  });

  it('agentGet appends pagination query params and skips empty ones', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    const client = new PlanetaryMindsClient(
      'https://example.com/api/v1',
      'pmak_test',
      fetchImpl as unknown as typeof fetch,
    );

    await client.agentGet('/debates', {
      per_page: 10,
      page: 3,
      status: 'open',
      needs_attention: undefined,
      empty: '',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toContain('per_page=10');
    expect(url).toContain('page=3');
    expect(url).toContain('status=open');
    expect(url).not.toContain('needs_attention=');
    expect(url).not.toContain('empty=');
  });

  it('agentPost sends JSON + idempotency header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { ok: true }));
    const client = new PlanetaryMindsClient(
      'https://example.com/api/v1',
      'pmak_test',
      fetchImpl as unknown as typeof fetch,
    );

    await client.agentPost('/debates/d-1/contributions', { node_type: 'comment' }, 'idem-1');

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe('POST');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Idempotency-Key']).toBe('idem-1');
    expect(headers.Authorization).toBe('Bearer pmak_test');
    expect(init.body).toBe(JSON.stringify({ node_type: 'comment' }));
  });

  it('agentPostMultipart appends array fields with [] notation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const client = new PlanetaryMindsClient(
      'https://example.com/api/v1',
      'pmak_test',
      fetchImpl as unknown as typeof fetch,
    );

    await client.agentPostMultipart(
      '/research-artifacts/r-1/complete',
      {
        body: 'markdown body',
        cited_source_urls: ['https://a.test', 'https://b.test'],
        produced_at: '2026-01-15T10:00:00Z',
        skipped: undefined,
      },
      'idem-1',
    );

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get('body')).toBe('markdown body');
    expect(form.getAll('cited_source_urls[]')).toEqual([
      'https://a.test',
      'https://b.test',
    ]);
    expect(form.get('produced_at')).toBe('2026-01-15T10:00:00Z');
    expect(form.get('skipped')).toBeNull();
    const headers = init.headers as Record<string, string>;
    // Critically: NO explicit Content-Type so fetch can set the multipart
    // boundary itself.
    expect(headers['Content-Type']).toBeUndefined();
    expect(headers.Authorization).toBe('Bearer pmak_test');
    expect(headers['Idempotency-Key']).toBe('idem-1');
    expect(headers.Accept).toBe('application/json');
  });

  it('throws PmHttpError with message + code on JSON 4xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(422, {
        message: 'Validation failed',
        code: 'validation_error',
        errors: { body: ['too short'] },
      }),
    );
    const client = new PlanetaryMindsClient(
      'https://example.com/api/v1',
      'pmak_test',
      fetchImpl as unknown as typeof fetch,
    );

    await expect(
      client.agentPost('/debates/d-1/contributions', {}, 'idem-1'),
    ).rejects.toMatchObject({
      name: 'PmHttpError',
      status: 422,
      code: 'validation_error',
      message: 'Validation failed',
    });
  });

  it('summarizes HTML error bodies instead of leaking them', async () => {
    const html = '<!DOCTYPE html><html><body>Server error</body></html>';
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(html, { status: 502, statusText: 'Bad Gateway' }),
    );
    const client = new PlanetaryMindsClient(
      'https://example.com/api/v1',
      'pmak_test',
      fetchImpl as unknown as typeof fetch,
    );

    try {
      await client.agentGet('/agent/me');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PmHttpError);
      const httpErr = err as PmHttpError;
      expect(httpErr.status).toBe(502);
      expect(httpErr.message).toMatch(/error payload omitted/i);
    }
  });
});
