import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { SessionStore } from '../core/session.store';
import { PhotoComponent } from '../shared/photo.component';

interface TreeNode {
  id: string;
  code: string;
  name: string;
  status: string;
  designation: string;
  department: string;
  location: string;
  reports: number;
  photoAt: string | null;
}

interface TreeView {
  selfId: string | null;
  me: TreeNode | null;
  chain: TreeNode[];
  peers: TreeNode[];
  reports: TreeNode[];
  team: { name: string; department: string; lead: TreeNode | null; members: TreeNode[] } | null;
  leads: { name: string; members: TreeNode[] }[];
  people: number;
}

const PEEK = 8;

@Component({
  selector: 'app-reporting',
  imports: [RouterLink, PhotoComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-diagram-3"></i></span>
        <p class="eyebrow">My day</p>
        <h1>Reporting line</h1>
        <p class="muted">Who you report to, your team lead, the people beside you, and anyone who reports to you. Click a person to see their line.</p>
      </div>
      @if (!isSelf()) {
        <button type="button" class="btn btn-ghost" (click)="focus(null)"><i class="bi bi-person"></i> Back to me</button>
      }
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }

    @if (view && !view.me) {
      <section class="card"><div class="empty-state"><i class="bi bi-diagram-3"></i><strong>No employee record is linked to this sign-in</strong><p>Your reporting line appears once HR links your sign-in to an employee record.</p></div></section>
    }

    @if (view?.me; as me) {
      @if (!isSelf()) {
        <p class="banner rt-banner"><i class="bi bi-binoculars"></i> Showing the reporting line of {{ me.name }}.</p>
      }

      <div class="rt-facts">
        <div class="card bento-stat">
          <span class="bento-ico"><i class="bi bi-person-up"></i></span>
          <span class="muted">Reports to</span>
          @if (view!.chain[0]; as boss) { <button type="button" class="rt-fact-link" (click)="focus(boss.id)">{{ boss.name }}</button><small class="muted">{{ boss.designation || 'No designation' }}</small> } @else { <strong>Nobody</strong><small class="muted">Top of the company</small> }
        </div>
        <div class="card bento-stat">
          <span class="bento-ico is-gold"><i class="bi bi-flag"></i></span>
          <span class="muted">Team lead</span>
          @if (view!.team?.lead; as lead) {
            @if (lead.id === me.id) { <strong>{{ isSelf() ? 'You' : me.name }}</strong> } @else { <button type="button" class="rt-fact-link" (click)="focus(lead.id)">{{ lead.name }}</button> }
            <small class="muted">{{ view!.team!.name }}</small>
          } @else if (view!.team) { <strong>Not set</strong><small class="muted">{{ view!.team!.name }}</small> } @else { <strong>Not in a team</strong><small class="muted">HR sets teams on People</small> }
        </div>
        <div class="card bento-stat">
          <span class="bento-ico"><i class="bi bi-people"></i></span>
          <span class="muted">Teammates</span>
          <strong>{{ view!.peers.length }}</strong>
          <small class="muted">{{ view!.chain[0] ? 'Also report to ' + view!.chain[0].name : 'No shared manager' }}</small>
        </div>
        <div class="card bento-stat">
          <span class="bento-ico"><i class="bi bi-diagram-2"></i></span>
          <span class="muted">Direct reports</span>
          <strong>{{ view!.reports.length }}</strong>
          <small class="muted">{{ view!.reports.length ? 'Report to ' + (isSelf() ? 'you' : me.name) : 'Nobody reports here' }}</small>
        </div>
      </div>

      <section class="card rt-tree" aria-label="Reporting tree">
        @if (view!.chain.length > 1) {
          <div class="rt-level rt-up">
            @if (!showChain && view!.chain.length > 3) {
              <button type="button" class="btn btn-ghost btn-sm" (click)="showChain = true"><i class="bi bi-chevron-up"></i> {{ view!.chain.length - 2 }} more above</button>
              <span class="rt-link" aria-hidden="true"></span>
            }
          </div>
        }
        @for (boss of upper(); track boss.id) {
          <div class="rt-level">
            <button type="button" class="rt-node" (click)="focus(boss.id)">
              <app-photo size="md" [personId]="boss.id" [name]="boss.name" [stamp]="boss.photoAt" />
              <span class="rt-text"><strong>{{ boss.name }}</strong><small>{{ boss.designation || 'No designation' }}</small><em>{{ place(boss) }}</em></span>
              @if (boss.reports) { <span class="rt-count" [title]="boss.reports + ' direct reports'">{{ boss.reports }}</span> }
            </button>
          </div>
          <span class="rt-link" aria-hidden="true"></span>
        }

        <div class="rt-group">
          @if (view!.chain[0]) { <p class="rt-group-label">Reports to {{ view!.chain[0].name }} · {{ view!.peers.length + 1 }} {{ view!.peers.length ? 'people' : 'person' }}</p> }
          <div class="rt-row">
            <div class="rt-node is-focus">
              <app-photo size="md" [personId]="me.id" [name]="me.name" [stamp]="me.photoAt" />
              <span class="rt-text"><strong>{{ me.name }}@if (isSelf()) { <span class="rt-you">You</span> }</strong><small>{{ me.designation || 'No designation' }}</small><em>{{ place(me) }}</em></span>
              @if (canOpen) { <a class="rt-open" [routerLink]="'/people/' + me.id" aria-label="Open profile" title="Open profile"><i class="bi bi-box-arrow-up-right"></i></a> }
            </div>
            @for (peer of peerList(); track peer.id) {
              <button type="button" class="rt-node is-peer" (click)="focus(peer.id)">
                <app-photo size="sm" [personId]="peer.id" [name]="peer.name" [stamp]="peer.photoAt" />
                <span class="rt-text"><strong>{{ peer.name }}</strong><small>{{ peer.designation || 'No designation' }}</small></span>
                @if (peer.reports) { <span class="rt-count">{{ peer.reports }}</span> }
              </button>
            }
            @if (view!.peers.length > peek && !showPeers) {
              <button type="button" class="btn btn-ghost btn-sm rt-more" (click)="showPeers = true">+{{ view!.peers.length - peek }} more</button>
            }
          </div>
        </div>

        @if (view!.reports.length) {
          <span class="rt-link" aria-hidden="true"></span>
          <div class="rt-group">
            <p class="rt-group-label">Report to {{ isSelf() ? 'you' : me.name }} · {{ view!.reports.length }}</p>
            <div class="rt-row">
              @for (item of view!.reports; track item.id) {
                <button type="button" class="rt-node" (click)="focus(item.id)">
                  <app-photo size="sm" [personId]="item.id" [name]="item.name" [stamp]="item.photoAt" />
                  <span class="rt-text"><strong>{{ item.name }}</strong><small>{{ item.designation || 'No designation' }}</small></span>
                  @if (item.reports) { <span class="rt-count" [title]="item.reports + ' direct reports'">{{ item.reports }}</span> }
                </button>
              }
            </div>
          </div>
        }
      </section>

      @if (view!.team; as team) {
        <section class="card rt-team">
          <header class="rt-team-head">
            <span class="bento-ico is-gold"><i class="bi bi-people-fill"></i></span>
            <div><h2>{{ team.name }}</h2><p class="muted">{{ team.department || 'No department' }} · {{ team.members.length + (team.lead ? 1 : 0) }} {{ team.members.length + (team.lead ? 1 : 0) === 1 ? 'person' : 'people' }}</p></div>
          </header>
          @if (team.lead; as lead) {
            <p class="rt-group-label">Team lead</p>
            <div class="rt-row is-left">
              <button type="button" class="rt-node is-lead" (click)="focus(lead.id)">
                <app-photo size="md" [personId]="lead.id" [name]="lead.name" [stamp]="lead.photoAt" />
                <span class="rt-text"><strong>{{ lead.name }}@if (lead.id === view!.selfId) { <span class="rt-you">You</span> }</strong><small>{{ lead.designation || 'No designation' }}</small><em>{{ place(lead) }}</em></span>
              </button>
            </div>
          } @else {
            <p class="muted">This team has no lead yet. HR sets one on Organisation.</p>
          }
          @if (team.members.length) {
            <p class="rt-group-label">Members</p>
            <div class="rt-row is-left">
              @for (item of team.members; track item.id) {
                <button type="button" class="rt-node is-peer" [class.is-focus-soft]="item.id === me.id" (click)="focus(item.id)">
                  <app-photo size="sm" [personId]="item.id" [name]="item.name" [stamp]="item.photoAt" />
                  <span class="rt-text"><strong>{{ item.name }}@if (item.id === view!.selfId) { <span class="rt-you">You</span> }</strong><small>{{ item.designation || 'No designation' }}</small></span>
                </button>
              }
            </div>
          }
        </section>
      }

      @for (led of view!.leads; track led.name) {
        <section class="card rt-team">
          <header class="rt-team-head">
            <span class="bento-ico"><i class="bi bi-flag-fill"></i></span>
            <div><h2>{{ isSelf() ? 'You lead' : me.name + ' leads' }} {{ led.name }}</h2><p class="muted">{{ led.members.length }} {{ led.members.length === 1 ? 'member' : 'members' }}</p></div>
          </header>
          @if (led.members.length) {
            <div class="rt-row is-left">
              @for (item of led.members; track item.id) {
                <button type="button" class="rt-node is-peer" (click)="focus(item.id)">
                  <app-photo size="sm" [personId]="item.id" [name]="item.name" [stamp]="item.photoAt" />
                  <span class="rt-text"><strong>{{ item.name }}</strong><small>{{ item.designation || 'No designation' }}</small></span>
                </button>
              }
            </div>
          } @else { <p class="muted">Nobody is on this team yet.</p> }
        </section>
      }
    }

    @if (!view && !error) {
      <section class="card"><p class="muted"><i class="bi bi-hourglass-split"></i> Loading the reporting line…</p></section>
    }
  `,
})
export class ReportingComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly peek = PEEK;
  view: TreeView | null = null;
  error = '';
  showChain = false;
  showPeers = false;

  get canOpen(): boolean {
    return !!this.store.me?.access?.includes('people');
  }

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => void this.load(params.get('id')));
  }

  isSelf(): boolean {
    return !!this.view?.me && this.view.me.id === this.view.selfId;
  }

  focus(id: string | null): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { id: id && id !== this.view?.selfId ? id : null } });
  }

  upper(): TreeNode[] {
    const chain = [...(this.view?.chain || [])].reverse();
    return this.showChain || chain.length <= 3 ? chain : chain.slice(-2);
  }

  peerList(): TreeNode[] {
    const peers = this.view?.peers || [];
    return this.showPeers ? peers : peers.slice(0, PEEK);
  }

  place(node: TreeNode): string {
    return [node.department, node.location, node.code].filter(Boolean).join(' · ');
  }

  private async load(id: string | null): Promise<void> {
    this.error = '';
    this.showChain = false;
    this.showPeers = false;
    try {
      this.view = await this.api.get<TreeView>('/v1/reporting' + (id ? '?id=' + encodeURIComponent(id) : ''));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load the reporting line.';
    }
  }
}
