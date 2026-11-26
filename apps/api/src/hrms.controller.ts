import { Body, Controller, Get, Header, Param, Patch, Post, Query, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { AuthGuard, RequestWithSession } from './auth.guard';
import { AuthService } from './auth.service';
import { BrandService } from './brand.service';
import { DeskService } from './desk.service';
import { DeviceService } from './device.service';
import { DirectoryService } from './directory.service';
import { fail, optional, text } from './http';
import { FormsService } from './forms.service';
import { HiringService } from './hiring.service';
import { VendorService } from './vendor.service';
import { LicenceService } from './licence.service';
import { ManualService } from './manual.service';
import { OutletService } from './outlet.service';
import { AccessService } from './access.service';
import { SettingsService } from './settings.service';
import { LibraryService } from './library.service';
import { NoticeService } from './notice.service';
import { PayService } from './pay.service';
import { RecognitionService } from './recognition.service';
import { SelfService } from './self.service';
import { AssetService } from './asset.service';
import { AssetDetailsService } from './asset-details.service';
import { HomeLayoutService } from './home-layout.service';
import { PublicController } from './public.controller';
import { SystemService } from './system.service';
import { ReportsService } from './reports.service';
import { AutomationService } from './automation.service';
import { GrowthService } from './growth.service';
import { WorkplaceService } from './workplace.service';
import { AiService } from './ai.service';
import { bag } from './http';
import type { ChatMessage } from './ai.types';

@Controller('v1')
@UseGuards(AuthGuard)
export class HrmsController {
  constructor(
    private readonly directory: DirectoryService,
    private readonly devices: DeviceService,
    private readonly desk: DeskService,
    private readonly workplace: WorkplaceService,
    private readonly growth: GrowthService,
    private readonly library: LibraryService,
    private readonly notices: NoticeService,
    private readonly pay: PayService,
    private readonly recognition: RecognitionService,
    private readonly licence: LicenceService,
    private readonly auth: AuthService,
    private readonly brand: BrandService,
    private readonly settings: SettingsService,
    private readonly forms: FormsService,
    private readonly hiring: HiringService,
    private readonly vendors: VendorService,
    private readonly gates: AccessService,
    private readonly self: SelfService,
    private readonly assetDesk: AssetService,
    private readonly assetDetails: AssetDetailsService,
    private readonly homeLayout: HomeLayoutService,
    private readonly system: SystemService,
    private readonly reports: ReportsService,
    private readonly automation: AutomationService,
    private readonly outlets: OutletService,
    private readonly manual: ManualService,
    private readonly ai: AiService,
  ) {}

  @Get('ai/bootstrap')
  aiBootstrap(@Req() request: RequestWithSession) {
    return this.ai.bootstrap(request.session);
  }

  @Post('ai/chat')
  aiChat(@Req() request: RequestWithSession, @Body() body: unknown) {
    const input = bag(body);
    const pagePath = String(input.pagePath || '').slice(0, 200);
    const raw = Array.isArray(input.messages) ? input.messages : [];
    const messages = raw
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const row = item as Record<string, unknown>;
        const roleRaw = String(row.role || 'user');
        const role = roleRaw === 'assistant' || roleRaw === 'system' ? roleRaw : 'user';
        const content = String(row.content || '').slice(0, 8000);
        return { role, content } as const;
      })
      .filter((item) => item.content.trim());
    if (!messages.length) fail(400, 'Add a message to send.');
    return this.ai.chatForStaff(request.session, messages as ChatMessage[], pagePath);
  }

  @Post('ai/confirm')
  aiConfirm(@Req() request: RequestWithSession, @Body() body: unknown) {
    const input = bag(body);
    const tool = String(input.tool || '').trim();
    const args = input.args && typeof input.args === 'object' && !Array.isArray(input.args)
      ? (input.args as Record<string, unknown>)
      : {};
    if (!tool) fail(400, 'Choose an action to confirm.');
    return this.ai.confirmAction(request.session, tool, args);
  }

  @Get('ai/status')
  async aiStatus(@Req() request: RequestWithSession) {
    const cfg = await this.settings.aiConfig(request.session.companyId);
    const ready = cfg.enabled && cfg.accounts.some((row) => row.enabled && row.apiKeyEnc);
    return { enabled: cfg.enabled, ready };
  }

  @Get('manual')
  manualView(@Req() request: RequestWithSession, @Query('role') role?: string) {
    return this.manual.view(request.session, role);
  }

  @Get('manual/pdf')
  async manualPdf(@Req() request: RequestWithSession, @Query('role') role?: string): Promise<StreamableFile> {
    const file = await this.manual.pdf(request.session, role);
    return new StreamableFile(file.bytes, { type: file.type, disposition: `attachment; filename="${file.name}"` });
  }

  @Get('automation')
  automationView(@Req() request: RequestWithSession) {
    return this.automation.view(request.session);
  }

  @Post('automation/policy')
  automationPolicy(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.automation.savePolicy(request.session, body);
  }

  @Post('automation/run')
  automationRun(@Req() request: RequestWithSession) {
    return this.automation.runNow(request.session);
  }

  @Get('leave/types')
  leaveTypeList(@Req() request: RequestWithSession) {
    return this.workplace.leaveTypes(request.session);
  }

  @Post('leave/types')
  saveLeaveType(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.workplace.saveLeaveType(request.session, body);
  }

  @Get('payroll/month/:month')
  payrollMonth(@Req() request: RequestWithSession, @Param('month') month: string) {
    return this.pay.month(request.session, month);
  }

  @Get('payroll/days')
  payrollDays(@Req() request: RequestWithSession, @Query('employeeId') employeeId: string, @Query('month') month: string) {
    return this.pay.days(request.session, String(employeeId || ''), String(month || ''));
  }

  @Post('payroll/month/start')
  payrollStart(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.pay.startMonth(request.session, body);
  }

  @Post('payroll/month/publish')
  payrollPublish(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.pay.publishMonth(request.session, body);
  }

  @Post('payroll/month/lock')
  payrollLock(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.pay.lockMonth(request.session, body);
  }

  @Get('payroll/bank-file/:month')
  @Header('Cache-Control', 'no-store')
  async payrollBankFile(@Req() request: RequestWithSession, @Param('month') month: string, @Query('account') account?: string): Promise<StreamableFile> {
    const file = await this.pay.bankFile(request.session, month, String(account || '').slice(0, 32));
    return new StreamableFile(Buffer.from(file.csv, 'utf8'), { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="${file.name}"` });
  }

  @Post('people/import')
  importPeople(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.directory.importPeople(request.session, body);
  }

  @Get('hiring/applications/:id/prefill')
  hiringPrefill(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.hiring.prefill(request.session, id);
  }

  @Post('hiring/applications/:id/person')
  hiringCreatePerson(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.hiring.createPerson(request.session, id, body);
  }

  @Get('reports')
  reportList(@Req() request: RequestWithSession) {
    return this.reports.list(request.session);
  }

  @Get('reports/:key')
  reportRun(@Req() request: RequestWithSession, @Param('key') key: string, @Query() query: Record<string, unknown>) {
    return this.reports.run(request.session, key, query || {});
  }

  @Get('system/map')
  systemMap(@Req() request: RequestWithSession) {
    return this.system.map(request.session, [HrmsController, PublicController]);
  }

  @Get('me')
  async me(@Req() request: RequestWithSession) {
    const session = request.session;
    const [me, list] = await Promise.all([this.directory.me(session), this.outlets.mine(session)]);
    return { ...me, outlets: { current: session.outletId ?? null, master: session.master === true, payroll: !session.outletCountry || session.outletCountry === 'IN', list } };
  }

  @Get('outlets')
  outletList(@Req() request: RequestWithSession) {
    return this.outlets.list(request.session);
  }

  @Post('outlets')
  outletCreate(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.outlets.create(request.session, body);
  }

  @Patch('outlets/:id')
  outletUpdate(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.outlets.update(request.session, id, body);
  }

  @Post('outlets/:id/status')
  outletStatus(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.outlets.setStatus(request.session, id, body);
  }

  @Post('outlets/:id/members')
  outletMember(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.outlets.setMember(request.session, id, body);
  }

  @Post('outlets/:id/copy')
  outletCopy(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.outlets.copySetup(request.session, id, body);
  }

  @Post('outlets/masters')
  outletMaster(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.outlets.setMaster(request.session, body);
  }

  @Get('notifications')
  notifications(@Req() request: RequestWithSession, @Query('limit') limit?: string) {
    return this.notices.inbox(request.session, Number(limit) || 8);
  }

  @Post('notifications/read')
  readNotifications(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.notices.read(request.session, optional(bag(body).id, 40));
  }

  @Get('brand')
  brandView(@Req() request: RequestWithSession) {
    return this.brand.forSession(request.session);
  }

  @Post('brand')
  saveBrand(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.brand.save(request.session, body);
  }

  @Post('brand/icon')
  saveIcon(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.brand.saveImage(request.session, 'icon', body);
  }

  @Post('brand/logo')
  saveLogo(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.brand.saveImage(request.session, 'logo', body);
  }

  @Get('brand/icon')
  @Header('Cache-Control', 'private, max-age=30')
  async brandIcon(@Req() request: RequestWithSession): Promise<StreamableFile> {
    return this.brandFile(request.session.companyId, 'icon');
  }

  @Get('brand/logo')
  @Header('Cache-Control', 'private, max-age=30')
  async brandLogo(@Req() request: RequestWithSession): Promise<StreamableFile> {
    return this.brandFile(request.session.companyId, 'logo');
  }

  private async brandFile(companyId: string, kind: 'icon' | 'logo'): Promise<StreamableFile> {
    const file = await this.brand.image(companyId, kind);
    if (!file) fail(404, 'That image has not been uploaded.');
    return new StreamableFile(file.bytes, { type: file.type });
  }

  @Get('settings')
  settingsView(@Req() request: RequestWithSession) {
    return this.settings.view(request.session);
  }

  @Post('settings')
  saveSettings(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.settings.save(request.session, body);
  }

  @Post('settings/mail/preview')
  previewMail(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.settings.previewMail(request.session, body);
  }

  @Post('settings/mail/test')
  testMail(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.settings.testMail(request.session, body);
  }

  @Get('access/me')
  myAccess(@Req() request: RequestWithSession) {
    return this.gates.panel(request.session);
  }

  @Get('access/person/:id')
  personAccess(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.gates.panel(request.session, id);
  }

  @Post('access/person')
  savePersonAccess(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.gates.savePanel(request.session, body);
  }

  @Get('access')
  accessView(@Req() request: RequestWithSession) {
    return this.gates.view(request.session);
  }

  @Post('access')
  saveAccess(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.gates.save(request.session, body);
  }

  @Get('forms')
  listForms(@Req() request: RequestWithSession) {
    return this.forms.list(request.session);
  }

  @Post('forms')
  createForm(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.forms.create(request.session, body);
  }

  @Get('forms/:id')
  form(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.forms.get(request.session, id);
  }

  @Get('forms/:id/preview')
  formPreview(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.forms.staffPreview(request.session, id);
  }

  @Patch('forms/:id')
  updateForm(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.forms.update(request.session, id, body);
  }

  @Post('forms/:id/duplicate')
  duplicateForm(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.forms.duplicate(request.session, id);
  }

  @Get('hiring/applications/:id/files/:fileId')
  async applicationFile(@Req() request: RequestWithSession, @Param('id') id: string, @Param('fileId') fileId: string): Promise<StreamableFile> {
    const file = await this.forms.applicationFile(request.session, id, fileId);
    if (!file) fail(404, 'That file was not found.');
    return this.inlineFile(file);
  }

  @Post('forms/:id/delete')
  deleteForm(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.forms.remove(request.session, id);
  }

  @Get('forms/:id/submissions')
  formSubmissions(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.forms.submissions(request.session, id);
  }

  @Get('hiring/applications')
  hiringApplications(@Req() request: RequestWithSession) {
    return this.hiring.applications(request.session);
  }

  @Get('hiring/applications/:id')
  async hiringApplication(@Req() request: RequestWithSession, @Param('id') id: string) {
    const view = await this.hiring.application(request.session, id);
    return { ...view, ...(await this.forms.extras(request.session.companyId, id)) };
  }

  @Get('hiring/rules')
  hiringRules(@Req() request: RequestWithSession) {
    return this.hiring.rules(request.session);
  }

  @Post('hiring/rules')
  saveHiringRules(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.hiring.saveRules(request.session, body);
  }

  @Patch('hiring/applications/:id')
  updateHiringApplication(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.hiring.updateApplication(request.session, id, body);
  }

  @Get('hiring/portals')
  hiringPortals(@Req() request: RequestWithSession) {
    return this.hiring.list(request.session);
  }

  @Post('hiring/portals')
  saveHiringPortals(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.hiring.savePortals(request.session, body);
  }

  @Post('hiring/portals/rotate')
  rotateHiringFeed(@Req() request: RequestWithSession) {
    return this.hiring.rotateToken(request.session);
  }

  @Post('hiring/portals/:portal/check')
  checkHiringPortal(@Req() request: RequestWithSession, @Param('portal') portal: string) {
    return this.hiring.checkPortal(request.session, portal);
  }

  @Get('hiring/internal')
  async internalJobs(@Req() request: RequestWithSession) {
    if (!(await this.jobsOpen(request))) return { openings: [], mine: [], visible: false };
    const board = await this.hiring.internalBoard(request.session);
    return { ...board, visible: true };
  }

  @Post('hiring/internal/:id/apply')
  async applyInternal(@Req() request: RequestWithSession, @Param('id') id: string) {
    if (!(await this.jobsOpen(request))) fail(403, 'Jobs inside the company are turned off for your role.');
    return this.hiring.applyInternal(request.session, id);
  }

  @Post('hiring/internal/:id/refer')
  async referCandidate(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    if (!(await this.jobsOpen(request))) fail(403, 'Jobs inside the company are turned off for your role.');
    return this.hiring.refer(request.session, id, body);
  }

  @Get('vendors')
  vendorList(@Req() request: RequestWithSession) {
    return this.vendors.list(request.session);
  }

  @Post('vendors/mode')
  vendorMode(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.vendors.saveMode(request.session, body);
  }

  @Post('vendors')
  saveVendor(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.vendors.save(request.session, body);
  }

  @Post('vendors/:id')
  updateVendor(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.vendors.save(request.session, body, id);
  }

  @Post('vendors/:id/remove')
  removeVendor(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.vendors.remove(request.session, id);
  }

  @Get('hiring')
  hiringList(@Req() request: RequestWithSession) {
    return this.hiring.list(request.session);
  }

  @Post('hiring')
  createOpening(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.hiring.create(request.session, body);
  }

  @Get('hiring/:id')
  opening(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.hiring.get(request.session, id);
  }

  @Patch('hiring/:id')
  updateOpening(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.hiring.update(request.session, id, body);
  }

  @Post('hiring/:id/delete')
  deleteOpening(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.hiring.remove(request.session, id);
  }

  @Patch('company')
  updateCompany(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.directory.updateCompany(request.session, body);
  }

  @Get('home')
  home(@Req() request: RequestWithSession) {
    return this.workplace.home(request.session);
  }

  @Get('growth')
  growthView(@Req() request: RequestWithSession, @Query('person') person?: string) {
    return this.growth.view(request.session, String(person || ''));
  }

  @Post('growth')
  saveGrowth(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.growth.save(request.session, body);
  }

  @Post('growth/remove')
  removeGrowth(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.growth.remove(request.session, body);
  }

  @Get('home/layouts')
  homeLayouts(@Req() request: RequestWithSession, @Query('kind') kind?: string, @Query('id') id?: string) {
    return this.homeLayout.editor(request.session, String(kind || 'company'), String(id || ''));
  }

  @Post('home/layouts')
  saveHomeLayout(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.homeLayout.save(request.session, body);
  }

  @Post('home/mine')
  saveMyHome(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.homeLayout.saveMine(request.session, body);
  }

  @Post('wishes/draft')
  wishDraft(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.workplace.wishDraft(request.session, body);
  }

  @Post('wishes/preview')
  wishPreview(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.workplace.wishPreview(request.session, body);
  }

  @Post('wishes')
  sendWish(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.workplace.sendWish(request.session, body);
  }

  @Get('recognition/people')
  recognitionPeople(@Req() request: RequestWithSession, @Query('q') q = '') {
    return this.recognition.find(request.session, q);
  }

  @Get('recognition/fresh')
  freshBadges(@Req() request: RequestWithSession) {
    return this.recognition.fresh(request.session);
  }

  @Post('recognition/seen')
  badgesSeen(@Req() request: RequestWithSession) {
    return this.recognition.seen(request.session);
  }

  @Get('recognition')
  recognitionBoard(@Req() request: RequestWithSession, @Query('range') range?: string) {
    return this.recognition.view(request.session, range);
  }

  @Post('recognition')
  giveBadge(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.recognition.give(request.session, body);
  }

  @Get('profile')
  profile(@Req() request: RequestWithSession) {
    return this.directory.profile(request.session);
  }

  @Patch('profile/details')
  updateMyDetails(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.self.updateMine(request.session, body);
  }

  @Get('profile/change')
  myDetailChange(@Req() request: RequestWithSession) {
    return this.self.myChange(request.session);
  }

  @Post('profile/change/:id/cancel')
  cancelDetailChange(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.self.cancelMine(request.session, id);
  }

  @Get('detail-changes')
  detailChanges(@Req() request: RequestWithSession) {
    return this.self.queue(request.session);
  }

  @Post('detail-changes/:id/decide')
  decideDetailChange(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.self.decide(request.session, id, body);
  }

  @Get('photos')
  photoBook(@Req() request: RequestWithSession) {
    return this.self.photoBook(request.session);
  }

  @Get('people/:id/photo')
  @Header('Cache-Control', 'private, max-age=300')
  async personPhoto(@Req() request: RequestWithSession, @Param('id') id: string): Promise<StreamableFile> {
    const bytes = await this.self.photo(request.session, id);
    if (!bytes) fail(404, 'No photo has been added.');
    return new StreamableFile(bytes, { type: 'image/jpeg' });
  }

  @Post('people/:id/photo')
  savePersonPhoto(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.self.savePhoto(request.session, id, body);
  }

  @Post('people/:id/photo/remove')
  removePersonPhoto(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.self.removePhoto(request.session, id);
  }

  @Get('directory')
  colleagueSearch(@Req() request: RequestWithSession, @Query('q') q = '') {
    return this.library.allowsKey(request.session, 'directory').then((allowed) => {
      if (!allowed) fail(403, 'Finding colleagues is turned off for your role.');
      return this.directory.directory(request.session, q);
    });
  }

  @Get('requests')
  myRequests(@Req() request: RequestWithSession) {
    return this.workplace.myRequests(request.session);
  }

  @Get('library/shelf')
  libraryShelf(@Req() request: RequestWithSession) {
    return this.library.shelf(request.session);
  }

  @Get('library')
  libraryView(@Req() request: RequestWithSession) {
    return this.library.view(request.session);
  }

  @Get('library/widgets')
  homeWidgets(@Req() request: RequestWithSession) {
    return this.library.widgets(request.session);
  }

  @Post('library/widgets')
  saveHomeWidgets(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.library.saveWidgets(request.session, body);
  }

  @Post('library/help')
  saveHelp(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.library.saveHelp(request.session, body);
  }

  @Post('library/help/delete')
  removeHelp(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.library.removeHelp(request.session, body);
  }

  @Post('library/handbook')
  saveHandbook(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.library.saveHandbook(request.session, body);
  }

  @Get('library/targets')
  documentTargets(@Req() request: RequestWithSession) {
    return this.library.targets(request.session);
  }

  @Post('library/files')
  saveDocument(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.library.saveFile(request.session, body);
  }

  @Post('library/files/publish')
  publishDocument(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.library.setFilePublished(request.session, body);
  }

  @Post('library/files/delete')
  removeDocument(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.library.removeFile(request.session, body);
  }

  @Get('library/files/:id')
  async documentFile(@Req() request: RequestWithSession, @Param('id') id: string): Promise<StreamableFile> {
    const file = await this.library.file(request.session, id);
    if (!file) fail(404, 'That document was not found.');
    return this.inlineFile(file);
  }

  @Get('library/handbook/file')
  async handbookFile(@Req() request: RequestWithSession): Promise<StreamableFile> {
    const file = await this.library.handbookFile(request.session);
    if (!file) fail(404, 'No handbook has been published.');
    return this.inlineFile(file);
  }

  @Get('licence')
  async showLicence(@Req() request: RequestWithSession) {
    await this.gates.gate(request.session, 'settings', 'You do not have access to the licence.');
    return this.licence.view(request.session.companyId);
  }

  @Post('licence/check')
  async checkLicence(@Req() request: RequestWithSession, @Body() body: unknown) {
    await this.gates.gate(request.session, 'settings', 'You do not have access to connect Altamid Control.');
    const input = bag(body);
    const licenseKey = input.licenseKey === undefined ? null : optional(input.licenseKey, 120);
    // Binding host is optional — the server uses WEB_ORIGIN when the owner only pastes a key.
    const bindingHost = input.bindingHost === undefined || input.bindingHost === null || input.bindingHost === ''
      ? null
      : text(input.bindingHost, 'Binding host', 200);
    return this.licence.saveAndCheck(request.session.companyId, licenseKey, bindingHost);
  }

  @Post('auth/password')
  password(@Req() request: RequestWithSession, @Body() body: unknown) {
    const input = bag(body);
    return this.auth.changePassword(request.session, String(input.current ?? ''), String(input.next ?? ''));
  }

  @Get('org')
  org(@Req() request: RequestWithSession) {
    return this.directory.org(request.session);
  }

  @Get('reporting')
  reporting(@Req() request: RequestWithSession, @Query('id') id?: string) {
    return this.directory.reporting(request.session, optional(id, 40) || undefined);
  }

  @Get('team')
  team(@Req() request: RequestWithSession) {
    return this.directory.team(request.session);
  }

  @Post('departments')
  addDepartment(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.directory.addDepartment(request.session, body);
  }

  @Post('designations')
  addDesignation(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.directory.addDesignation(request.session, body);
  }

  @Post('org/roles')
  addRole(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.gates.addRole(request.session, body);
  }

  @Post('org/levels')
  addLevel(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.directory.addLevel(request.session, body);
  }

  @Post('org/teams/:id/lead')
  setTeamLead(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.directory.setTeamLead(request.session, id, body);
  }

  @Post('org/teams')
  addTeam(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.directory.addTeam(request.session, body);
  }

  @Post('locations')
  addLocation(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.directory.addLocation(request.session, body);
  }

  @Get('assets')
  assets(@Req() request: RequestWithSession) {
    return this.assetDesk.list(request.session);
  }

  @Post('assets')
  addAsset(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.assetDesk.create(request.session, body);
  }

  @Patch('assets/:id')
  updateAsset(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.assetDesk.update(request.session, id, body);
  }

  @Get('assets/details')
  assetDetailList(@Req() request: RequestWithSession) {
    return this.assetDetails.list(request.session);
  }

  @Post('assets/:id/details')
  saveAssetDetails(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.assetDetails.save(request.session, id, body);
  }

  @Post('assets/:id/details/reveal')
  revealAssetDetail(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.assetDetails.reveal(request.session, id, String((body as { field?: unknown })?.field || ''));
  }

  @Get('assets/:id/history')
  assetHistory(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.assetDesk.history(request.session, id);
  }

  @Post('assets/:id/assign')
  assignAsset(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.assetDesk.assign(request.session, id, body);
  }

  @Post('assets/:id/return')
  returnAsset(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.assetDesk.giveBack(request.session, id, body);
  }

  @Post('assets/:id/status')
  assetStatus(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.assetDesk.setStatus(request.session, id, body);
  }

  @Post('assets/:id/remove')
  removeAsset(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.assetDesk.remove(request.session, id);
  }

  @Get('onboarding/:employeeId')
  onboarding(@Req() request: RequestWithSession, @Param('employeeId') employeeId: string) {
    return this.desk.tasks(request.session, employeeId);
  }

  @Post('onboarding/:employeeId')
  addTask(@Req() request: RequestWithSession, @Param('employeeId') employeeId: string, @Body() body: unknown) {
    return this.desk.addTask(request.session, employeeId, body);
  }

  @Get('exits')
  exits(@Req() request: RequestWithSession) {
    return this.desk.exits(request.session);
  }

  @Post('exits')
  submitExit(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.desk.submitExit(request.session, body);
  }

  @Post('exits/:id/decide')
  decideExit(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.desk.decideExit(request.session, id, body);
  }

  @Post('exits/:id/cancel')
  cancelExit(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.desk.cancelExit(request.session, id);
  }

  @Get('people')
  people(@Req() request: RequestWithSession, @Query('q') q = '', @Query('department') department = '', @Query('status') status = '') {
    return this.directory.listPeople(request.session, q, department, status);
  }

  @Post('people')
  createPerson(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.directory.createPerson(request.session, body);
  }

  @Get('people/:id')
  person(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.directory.getPerson(request.session, id);
  }

  @Patch('people/:id')
  updatePerson(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.directory.updatePerson(request.session, id, body);
  }

  @Post('people/:id/password')
  personPassword(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.directory.setPassword(request.session, id, body);
  }

  @Get('announcements')
  announcements(@Req() request: RequestWithSession) {
    return this.workplace.announcements(request.session);
  }

  @Post('announcements')
  createAnnouncement(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.workplace.createAnnouncement(request.session, body);
  }

  @Get('approvals')
  async approvalsBoard(@Req() request: RequestWithSession) {
    const board = await this.workplace.approvals(request.session);
    try {
      const details = await this.self.queue(request.session);
      const byId = new Map(details.map((row) => [row.id, row]));
      for (const row of board.waiting) {
        if (row.kind !== 'details') continue;
        const full = byId.get(row.id);
        if (full) row.fields = full.fields;
      }
    } catch {
      // No pay-detail access — leave those rows without field diffs.
    }
    return board;
  }

  @Get('leave')
  leave(@Req() request: RequestWithSession) {
    return this.workplace.leave(request.session);
  }

  @Post('leave')
  applyLeave(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.workplace.applyLeave(request.session, body);
  }

  @Post('leave/:id/decide')
  decideLeave(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.workplace.decideLeave(request.session, id, body);
  }

  @Get('attendance/me')
  attendanceMe(@Req() request: RequestWithSession) {
    if (!request.session.employeeId) return null;
    return this.workplace.myPunch(request.session);
  }

  @Get('attendance/calendar')
  attendanceCalendar(@Req() request: RequestWithSession, @Query('month') month?: string) {
    return this.workplace.calendar(request.session, month || '');
  }

  @Get('attendance/day')
  attendanceDay(@Req() request: RequestWithSession, @Query('day') day?: string) {
    return this.workplace.dayTeam(request.session, day || '');
  }

  @Get('attendance/queue')
  attendanceQueue(@Req() request: RequestWithSession) {
    return this.workplace.timeQueue(request.session);
  }

  @Post('attendance/requests')
  attendanceRequest(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.workplace.requestTime(request.session, body);
  }

  @Post('attendance/requests/:id/decide')
  decideAttendance(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.workplace.decideTime(request.session, id, body);
  }

  @Post('attendance/holidays')
  addHoliday(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.workplace.addHoliday(request.session, body);
  }

  @Post('attendance/holidays/delete')
  removeHoliday(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.workplace.removeHoliday(request.session, body);
  }

  @Get('attendance/devices')
  devicesList(@Req() request: RequestWithSession) {
    return this.devices.list(request.session);
  }

  @Post('attendance/devices')
  addDevice(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.devices.add(request.session, body);
  }

  @Post('attendance/devices/remove')
  removeDevice(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.devices.remove(request.session, body);
  }

  @Get('attendance/exceptions')
  attendanceExceptions(@Req() request: RequestWithSession, @Query('day') day?: string) {
    return this.workplace.exceptions(request.session, day);
  }

  @Post('attendance/exceptions/regularize')
  regularizeException(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.workplace.regularizeException(request.session, body);
  }

  @Get('attendance/live')
  livePunches(@Req() request: RequestWithSession) {
    return this.devices.live(request.session);
  }

  @Get('attendance')
  attendance(@Req() request: RequestWithSession) {
    return this.workplace.attendance(request.session);
  }

  @Post('attendance/punch')
  punch(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.workplace.punch(request.session, body || {});
  }

  @Get('onboarding/templates')
  onboardingTemplates(@Req() request: RequestWithSession) {
    return this.settings.onboardingView(request.session);
  }

  @Post('onboarding/templates')
  saveOnboardingTemplates(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.settings.saveOnboarding(request.session, body);
  }

  @Get('pay')
  myPay(@Req() request: RequestWithSession) {
    return this.pay.mine(request.session);
  }

  @Get('pay/layout')
  payLayout(@Req() request: RequestWithSession) {
    return this.pay.layout(request.session);
  }

  @Post('pay/layout')
  savePayLayout(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.pay.saveLayout(request.session, body);
  }

  @Post('pay/structure')
  savePayStructure(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.pay.saveStructure(request.session, body);
  }

  @Get('pay/ctc-templates')
  ctcTemplates(@Req() request: RequestWithSession) {
    return this.pay.ctcTemplates(request.session);
  }

  @Post('pay/ctc-templates')
  saveCtcTemplate(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.pay.saveCtcTemplate(request.session, body);
  }

  @Post('pay/ctc-templates/delete')
  removeCtcTemplate(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.pay.removeCtcTemplate(request.session, body);
  }

  @Post('pay/ctc-templates/apply')
  applyCtcTemplate(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.pay.applyCtcTemplate(request.session, body);
  }

  @Post('pay/slip')
  savePaySlip(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.pay.saveSlip(request.session, body);
  }

  @Post('pay/form')
  saveTaxForm(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.pay.saveForm(request.session, body);
  }

  @Post('pay/form/delete')
  removeTaxForm(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.pay.removeForm(request.session, body);
  }

  @Get('pay/form/:id')
  async taxFormFile(@Req() request: RequestWithSession, @Param('id') id: string): Promise<StreamableFile> {
    const file = await this.pay.formFile(request.session, id);
    if (!file) fail(404, 'That Form 16 was not found.');
    return this.inlineFile(file);
  }

  @Get('pay/:employeeId')
  personPay(@Req() request: RequestWithSession, @Param('employeeId') employeeId: string) {
    return this.pay.forEmployee(request.session, employeeId);
  }

  private inlineFile(file: { type: string; bytes: Buffer; name: string }): StreamableFile {
    const name = file.name.replace(/[^\w.\- ]+/g, '').slice(0, 80) || 'file';
    return new StreamableFile(file.bytes, { type: file.type, disposition: `inline; filename="${name}"` });
  }

  private async jobsOpen(request: RequestWithSession): Promise<boolean> {
    if (await this.gates.holds(request.session, 'people.edit') || await this.gates.holds(request.session, 'hiring')) return true;
    return this.library.allowsKey(request.session, 'jobs');
  }
}
