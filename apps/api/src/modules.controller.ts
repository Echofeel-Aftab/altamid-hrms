import { Body, Controller, Get, Param, Post, Query, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { AuthGuard, RequestWithSession } from './auth.guard';
import { FlexService } from './flex.service';
import { bag, fail } from './http';
import { PerformanceService } from './performance.service';
import { PrismaService } from './prisma.service';
import { RewardsService } from './rewards.service';
import { SeparationService } from './separation.service';
import { SuccessionService } from './succession.service';
import { SurveyService } from './survey.service';
import { TaxService } from './tax.service';
import { TransactionsService } from './transactions.service';

/** Tax declarations, separation, performance, surveys, choice pay, total rewards, succession and pinned modules. */
@Controller('v1')
@UseGuards(AuthGuard)
export class ModulesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tax: TaxService,
    private readonly separation: SeparationService,
    private readonly performance: PerformanceService,
    private readonly surveys: SurveyService,
    private readonly flex: FlexService,
    private readonly rewards: RewardsService,
    private readonly succession: SuccessionService,
    private readonly txs: TransactionsService,
  ) {}

  @Get('me/pins')
  async pins(@Req() request: RequestWithSession) {
    const user = await this.prisma.user.findFirst({ where: { id: request.session.id }, select: { pinsJson: true } });
    try {
      const parsed = JSON.parse(user?.pinsJson || '[]');
      return { pins: Array.isArray(parsed) ? parsed.map(String) : [] };
    } catch {
      return { pins: [] };
    }
  }

  @Post('me/pins')
  async savePins(@Req() request: RequestWithSession, @Body() body: unknown) {
    const raw = bag(body).pins;
    if (!Array.isArray(raw)) fail(400, 'Send the list of pinned pages.');
    const pins = [...new Set(raw.map(String).filter((path) => /^\/[a-z0-9/-]{0,60}$/.test(path)))].slice(0, 12);
    await this.prisma.user.updateMany({ where: { id: request.session.id, companyId: request.session.companyId }, data: { pinsJson: JSON.stringify(pins) } });
    return { pins };
  }

  @Get('tax')
  taxMine(@Req() request: RequestWithSession, @Query('year') year?: string) {
    return this.tax.mine(request.session, year);
  }

  @Post('tax/simulate')
  taxSimulate(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.tax.simulate(request.session, body);
  }

  @Post('tax/declaration')
  taxSave(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.tax.save(request.session, body);
  }

  @Post('tax/proof')
  taxProof(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.tax.addProof(request.session, body);
  }

  @Post('tax/proof/delete')
  taxProofRemove(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.tax.removeProof(request.session, body);
  }

  @Get('tax/proof/:id')
  async taxProofFile(@Req() request: RequestWithSession, @Param('id') id: string): Promise<StreamableFile> {
    const file = await this.tax.proofFile(request.session, id);
    if (!file) fail(404, 'That proof was not found.');
    return this.inline(file);
  }

  @Get('tax/desk')
  taxDesk(@Req() request: RequestWithSession, @Query('year') year?: string, @Query('status') status?: string) {
    return this.tax.desk(request.session, year, status || '');
  }

  @Get('tax/desk/:employeeId')
  taxDeskOne(@Req() request: RequestWithSession, @Param('employeeId') employeeId: string, @Query('year') year?: string) {
    return this.tax.deskOne(request.session, employeeId, year);
  }

  @Post('tax/verify')
  taxVerify(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.tax.verify(request.session, body);
  }

  @Post('tax/window')
  taxWindow(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.tax.saveWindow(request.session, body);
  }

  @Get('separation')
  separationBoard(@Req() request: RequestWithSession, @Query('status') status?: string) {
    return this.separation.board(request.session, status || '');
  }

  @Post('separation/start')
  separationStart(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.separation.start(request.session, body);
  }

  @Get('separation/:id')
  separationOne(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.separation.one(request.session, id);
  }

  @Post('separation/:id/override')
  separationOverride(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.separation.override(request.session, id, body);
  }

  @Post('separation/:id/checklist')
  separationChecklist(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.separation.checklist(request.session, id, body);
  }

  @Post('separation/:id/interview')
  separationInterview(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.separation.interview(request.session, id, body);
  }

  @Post('separation/:id/settlement')
  separationSettle(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.separation.settle(request.session, id, body);
  }

  @Post('separation/:id/close')
  separationClose(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.separation.close(request.session, id);
  }

  @Get('separation/:id/letter/:kind')
  async separationLetter(@Req() request: RequestWithSession, @Param('id') id: string, @Param('kind') kind: string): Promise<StreamableFile> {
    return this.attachment(await this.separation.letter(request.session, id, kind));
  }

  @Get('performance')
  performanceView(@Req() request: RequestWithSession, @Query('cycle') cycle?: string, @Query('person') person?: string) {
    return this.performance.view(request.session, cycle || '', person || '');
  }

  @Post('performance/cycles')
  performanceCycle(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.performance.saveCycle(request.session, body);
  }

  @Post('performance/cycles/:id/phase')
  performancePhase(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.performance.phase(request.session, id, body);
  }

  @Post('performance/goals')
  performanceGoal(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.performance.saveGoal(request.session, body);
  }

  @Post('performance/goals/:id/delete')
  performanceGoalRemove(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.performance.removeGoal(request.session, id);
  }

  @Post('performance/goals/:id/progress')
  performanceProgress(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.performance.progress(request.session, id, body);
  }

  @Post('performance/self')
  performanceSelf(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.performance.selfReview(request.session, body);
  }

  @Post('performance/manager')
  performanceManager(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.performance.managerReview(request.session, body);
  }

  @Post('performance/final')
  performanceFinal(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.performance.finalRating(request.session, body);
  }

  @Get('surveys')
  surveyList(@Req() request: RequestWithSession) {
    return this.surveys.list(request.session);
  }

  @Post('surveys')
  surveySave(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.surveys.save(request.session, body);
  }

  @Get('surveys/:id')
  surveyOne(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.surveys.one(request.session, id);
  }

  @Get('surveys/:id/results')
  surveyResults(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.surveys.results(request.session, id);
  }

  @Post('surveys/:id/status')
  surveyStatus(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.surveys.status(request.session, id, body);
  }

  @Post('surveys/:id/answer')
  surveyAnswer(@Req() request: RequestWithSession, @Param('id') id: string, @Body() body: unknown) {
    return this.surveys.answer(request.session, id, body);
  }

  @Post('surveys/:id/delete')
  surveyRemove(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.surveys.remove(request.session, id);
  }

  @Get('flex')
  flexView(@Req() request: RequestWithSession, @Query('year') year?: string, @Query('person') person?: string) {
    return this.flex.view(request.session, year, person || '');
  }

  @Post('flex/choice')
  flexChoose(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.flex.choose(request.session, body);
  }

  @Post('flex/decide')
  flexDecide(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.flex.decide(request.session, body);
  }

  @Post('flex/config')
  flexConfig(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.flex.saveConfig(request.session, body);
  }

  @Get('rewards')
  rewardsView(@Req() request: RequestWithSession, @Query('person') person?: string) {
    return this.rewards.view(request.session, person || '');
  }

  @Get('rewards/pdf')
  async rewardsPdf(@Req() request: RequestWithSession, @Query('person') person?: string): Promise<StreamableFile> {
    return this.attachment(await this.rewards.pdf(request.session, person || ''));
  }

  @Post('rewards/config')
  rewardsConfig(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.rewards.saveConfig(request.session, body);
  }

  @Get('transactions')
  transactions(@Req() request: RequestWithSession, @Query('from') from?: string, @Query('to') to?: string) {
    return this.txs.mine(request.session, { from, to });
  }

  @Get('approval-flows')
  approvalFlows(@Req() request: RequestWithSession) {
    return this.txs.flows(request.session);
  }

  @Post('approval-flows')
  saveApprovalFlows(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.txs.saveFlows(request.session, body);
  }

  @Get('succession')
  successionView(@Req() request: RequestWithSession) {
    return this.succession.view(request.session);
  }

  @Post('succession')
  successionSave(@Req() request: RequestWithSession, @Body() body: unknown) {
    return this.succession.save(request.session, body);
  }

  @Post('succession/:id/delete')
  successionRemove(@Req() request: RequestWithSession, @Param('id') id: string) {
    return this.succession.remove(request.session, id);
  }

  private inline(file: { type: string; bytes: Buffer; name: string }): StreamableFile {
    const name = file.name.replace(/[^\w.\- ]+/g, '').slice(0, 80) || 'file';
    return new StreamableFile(file.bytes, { type: file.type, disposition: `inline; filename="${name}"` });
  }

  private attachment(file: { type: string; bytes: Buffer; name: string }): StreamableFile {
    const name = file.name.replace(/[^\w.\- ]+/g, '').slice(0, 80) || 'file';
    return new StreamableFile(file.bytes, { type: file.type, disposition: `attachment; filename="${name}"` });
  }
}
