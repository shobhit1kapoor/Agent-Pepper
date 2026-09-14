import type { Mission, Permission } from './contracts.js';

export class PolicyError extends Error {
  constructor(readonly kind: 'domain' | 'action', readonly request: string, readonly capability?: Permission) { super(request); }
}

const actionRules: Array<{ permission: Permission; expression: RegExp; request: string }> = [
  { permission: 'checkout', expression: /checkout/i, request: 'checkout' },
  { permission: 'payment', expression: /purchase|pay(?:ment)?|billing|place order|submit order|confirm order/i, request: 'payment' },
  { permission: 'credential_entry', expression: /password|credit.?card|card number|cvv|security.?code|ssn|sign.?in|log.?in|email|phone|address/i, request: 'credential entry' },
  { permission: 'account_creation', expression: /create account|sign.?up|register/i, request: 'account creation' },
  { permission: 'external_action', expression: /book|reserve|submit|send|publish|delete|confirm/i, request: 'external action' },
];

export class MissionPolicy {
  constructor(private readonly mission: Mission) {}

  private has(permission: Permission): boolean { return this.mission.permissions.includes(permission); }
  private allowlistContains(url: URL): boolean {
    return this.mission.allowedDomains.some((entry) => {
      const normalized = entry.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
      const host = url.host.toLowerCase();
      return host === normalized || host.endsWith(`.${normalized}`);
    });
  }
  assertNavigation(raw: string): URL {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) throw new PolicyError('domain', `Blocked non-web protocol: ${url.protocol}`);
    if (!this.has('research')) throw new PolicyError('action', 'This mission does not permit research/navigation.', 'research');
    if (!this.allowlistContains(url)) throw new PolicyError('domain', `Approve ${url.host} before browsing it.`);
    return url;
  }
  assertInteraction(input: { kind: 'click' | 'fill' | 'select'; label: string; role: string; url: string }): void {
    const url = this.assertNavigation(input.url);
    const descriptor = `${input.label} ${input.role}`.trim();
    const actionRule = actionRules.find((rule) => rule.expression.test(descriptor));
    if (actionRule && !this.has(actionRule.permission)) {
      throw new PolicyError('action', `Approve ${actionRule.request} for ${input.label || input.role} on ${url.host} before Pepper proceeds.`, actionRule.permission);
    }
    if (input.kind === 'fill' || input.kind === 'select') {
      if (!this.has('form_fill')) throw new PolicyError('action', 'Approve form filling for this mission before changing a field.', 'form_fill');
    }
    if (input.kind === 'click' && /add to (cart|bag)|cart/i.test(descriptor) && !this.has('cart_add')) {
      throw new PolicyError('action', 'Approve cart additions for this mission before adding an item.', 'cart_add');
    }
    if (!this.allowlistContains(url)) throw new PolicyError('domain', `Approve ${url.host} before taking an action there.`);
  }
}
