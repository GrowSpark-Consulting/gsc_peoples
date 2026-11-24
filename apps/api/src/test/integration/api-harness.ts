/* eslint-disable @typescript-eslint/no-explicit-any -- supertest bodies are untyped JSON */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import request from 'supertest';
import type { Express } from 'express';
import { expect } from 'vitest';
import { ROLE_KEYS, type RoleKey } from '@gsc/contracts';
import { hashPassword } from '../../modules/auth/password';
import { resetData } from './seed';

/**
 * Shared scaffolding for HTTP-level integration tests on the scratch PostgreSQL database: two companies,
 * the four system roles in each, seeded people with real session logins (custom session auth, CSRF on writes).
 */
export const PASSWORD = 'correct-horse-battery';
export const id = () => randomUUID();

export interface Person {
  user: string;
  emp: string;
  email: string;
}

export class Harness {
  readonly people: Record<string, Person> = {};
  readonly sessions: Record<string, { cookie: string; csrf: string }> = {};
  readonly roles: Record<string, string> = {};
  app!: Express;

  constructor(
    readonly admin: pg.Client,
    readonly companyA: string,
    readonly companyB: string,
  ) {}

  private cookiesOf(res: request.Response): Record<string, string> {
    return Object.fromEntries(
      ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).map((c) => {
        const [pair] = c.split(';');
        const i = pair!.indexOf('=');
        return [pair!.slice(0, i), decodeURIComponent(pair!.slice(i + 1))];
      }),
    );
  }

  async login(who: string) {
    const res = await request(this.app).post('/api/v1/auth/login').send({ email: this.people[who]!.email, password: PASSWORD });
    expect(res.status, `login ${who}`).toBe(200);
    const c = this.cookiesOf(res);
    this.sessions[who] = { cookie: `gsc_session=${encodeURIComponent(c.gsc_session!)}; gsc_csrf=${encodeURIComponent(c.gsc_csrf!)}`, csrf: c.gsc_csrf! };
  }

  api(who: string, method: 'get' | 'post' | 'patch' | 'delete', url: string, body?: unknown) {
    const s = this.sessions[who]!;
    let req = (request(this.app) as any)[method](`/api/v1${url}`).set('cookie', s.cookie);
    if (method !== 'get') req = req.set('x-csrf-token', s.csrf);
    return body === undefined ? req : req.send(body);
  }

  /** Multipart/other raw request with the caller's session (CSRF set for writes). */
  raw(who: string, method: 'get' | 'post' | 'patch' | 'delete', url: string) {
    const s = this.sessions[who]!;
    let req = (request(this.app) as any)[method](`/api/v1${url}`).set('cookie', s.cookie);
    if (method !== 'get') req = req.set('x-csrf-token', s.csrf);
    return req;
  }

  async seedPerson(company: string, key: string, role: RoleKey, managerKey?: string, extra: { departmentId?: string; status?: string } = {}) {
    const user = id();
    const emp = id();
    const email = `${key}@example.com`;
    await this.admin.query(`INSERT INTO hr.users (id,"externalId",email,name,"passwordHash","updatedAt") VALUES ($1,$1,$2,$3,$4,now())`, [user, email, key, hashPassword(PASSWORD)]);
    await this.admin.query(
      `INSERT INTO hr.employees (id,"companyId","employeeNumber","firstName","lastName","managerId","departmentId",status,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
      [emp, company, `E-${key}`, key, key.toUpperCase(), managerKey ? this.people[managerKey]!.emp : null, extra.departmentId ?? null, extra.status ?? 'ACTIVE'],
    );
    await this.admin.query(`INSERT INTO hr.company_memberships (id,"companyId","userId","roleId","employeeId",status,"updatedAt") VALUES ($1,$2,$3,$4,$5,'ACTIVE',now())`, [id(), company, user, this.roles[`${company}:${role}`], emp]);
    this.people[key] = { user, emp, email };
  }

  /** Wipes all data, then creates both companies and the four system roles in each. */
  async reset() {
    await resetData(this.admin);
    for (const k of Object.keys(this.people)) delete this.people[k];
    for (const k of Object.keys(this.sessions)) delete this.sessions[k];
    await this.admin.query(`INSERT INTO hr.companies (id,name,timezone,"updatedAt") VALUES ($1,'Acme','Asia/Kolkata',now())`, [this.companyA]);
    await this.admin.query(`INSERT INTO hr.companies (id,name,"updatedAt") VALUES ($1,'Other Co',now())`, [this.companyB]);
    for (const company of [this.companyA, this.companyB])
      for (const key of ROLE_KEYS) {
        const rid = id();
        this.roles[`${company}:${key}`] = rid;
        await this.admin.query(`INSERT INTO hr.roles (id,"companyId",key,name,"isSystem","updatedAt") VALUES ($1,$2,$3,$3,true,now())`, [rid, company, key]);
      }
  }
}
