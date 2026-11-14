import { ManualService } from './manual.service';
import { Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { BrandService } from './brand.service';
import { AuthService } from './auth.service';
import { DeskService } from './desk.service';
import { DeviceService } from './device.service';
import { DirectoryService } from './directory.service';
import { SelfService } from './self.service';
import { AssetService } from './asset.service';
import { AssetDetailsService } from './asset-details.service';
import { HomeBoardService } from './home-board.service';
import { HomeLayoutService } from './home-layout.service';
import { SystemService } from './system.service';
import { HrmsController } from './hrms.controller';
import { LicenceService } from './licence.service';
import { OutletService } from './outlet.service';
import { PrismaService } from './prisma.service';
import { PublicController } from './public.controller';
import { SettingsService } from './settings.service';
import { FormsService } from './forms.service';
import { HiringService } from './hiring.service';
import { ApplicantService } from './applicant.service';
import { ReportsService } from './reports.service';
import { LeaveLedger } from './leave-ledger.service';
import { AutomationService } from './automation.service';
import { VendorService } from './vendor.service';
import { LibraryService } from './library.service';
import { PayService } from './pay.service';
import { RecognitionService } from './recognition.service';
import { AccessService } from './access.service';
import { NoticeService } from './notice.service';
import { GrowthService } from './growth.service';
import { WorkplaceService } from './workplace.service';
import { ModulesController } from './modules.controller';
import { ModuleConfigService } from './module-config.service';
import { TaxService } from './tax.service';
import { SeparationService } from './separation.service';
import { PerformanceService } from './performance.service';
import { SurveyService } from './survey.service';
import { FlexService } from './flex.service';
import { RewardsService } from './rewards.service';
import { SuccessionService } from './succession.service';
import { TransactionsService } from './transactions.service';
import { ApiKeyGuard } from './api-key.guard';
import { ExternalApiService } from './external-api.service';
import { ExternalRoutesController, OpenApiController } from './external-api.controller';
import { AiService } from './ai.service';
import { AiToolsService } from './ai-tools';

@Module({
  controllers: [PublicController, OpenApiController, ExternalRoutesController, HrmsController, ModulesController],
  providers: [TransactionsService, ModuleConfigService, TaxService, SeparationService, PerformanceService, SurveyService, FlexService, RewardsService, SuccessionService, PrismaService, AuthService, LicenceService, OutletService, BrandService, SettingsService, ApplicantService, HiringService, VendorService, FormsService, DirectoryService, DeviceService, DeskService, LibraryService, NoticeService, PayService, RecognitionService, GrowthService, WorkplaceService, AccessService, SelfService, AssetService, AssetDetailsService, HomeLayoutService, HomeBoardService, SystemService, LeaveLedger, ReportsService, AutomationService, ManualService, AuthGuard, ApiKeyGuard, ExternalApiService, AiToolsService, AiService],
})
export class AppModule {}
