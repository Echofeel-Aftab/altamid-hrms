import { Routes } from '@angular/router';
import { authGuard, featureGuard, guestGuard, signedInGuard } from './core/auth.guard';
import { ShellComponent } from './layout/shell.component';
import { ApplicationsComponent } from './pages/applications.component';
import { ApplicationComponent } from './pages/application.component';
import { AssetsComponent } from './pages/assets.component';
import { ApplyComponent } from './pages/apply.component';
import { CareerComponent } from './pages/career.component';
import { ApprovalsComponent } from './pages/approvals.component';
import { JobsComponent } from './pages/jobs.component';
import { LibraryComponent } from './pages/library.component';
import { ProfileComponent } from './pages/profile.component';
import { RecognitionComponent } from './pages/recognition.component';
import { RequestsComponent } from './pages/requests.component';
import { ReportingComponent } from './pages/reporting.component';
import { AttendanceComponent } from './pages/attendance.component';
import { ExceptionsComponent } from './pages/exceptions.component';
import { HiringComponent } from './pages/hiring.component';
import { GrowthComponent } from './pages/growth.component';
import { HomeComponent } from './pages/home.component';
import { OpeningComponent } from './pages/opening.component';
import { LeaveComponent } from './pages/leave.component';
import { LoginComponent } from './pages/login.component';
import { ManualComponent } from './pages/manual.component';
import { NewsComponent } from './pages/news.component';
import { NotificationsComponent } from './pages/notifications.component';
import { OrganisationComponent } from './pages/organisation.component';
import { OutletPickComponent } from './pages/outlet-pick.component';
import { PayComponent } from './pages/pay.component';
import { PayrollComponent } from './pages/payroll.component';
import { PeopleComponent } from './pages/people.component';
import { PeopleImportComponent } from './pages/people-import.component';
import { PersonComponent } from './pages/person.component';
import { SettingsComponent } from './pages/settings.component';
import { StartComponent } from './pages/start.component';
import { SystemComponent } from './pages/system.component';
import { ReportsComponent } from './pages/reports.component';
import { ResetComponent } from './pages/reset.component';
import { TeamComponent } from './pages/team.component';
import { VendorsComponent } from './pages/vendors.component';
import { TaxComponent } from './pages/tax.component';
import { SeparationComponent } from './pages/separation.component';
import { PerformanceComponent } from './pages/performance.component';
import { SurveysComponent } from './pages/surveys.component';
import { ChoicePayComponent } from './pages/choice-pay.component';
import { RewardsComponent } from './pages/rewards.component';
import { SuccessionComponent } from './pages/succession.component';


export const routes: Routes = [
  { path: 'login', component: LoginComponent, canActivate: [guestGuard] },
  { path: 'forgot', component: ResetComponent, canActivate: [guestGuard] },
  { path: 'reset', component: ResetComponent },
  { path: 'start', component: StartComponent, canActivate: [guestGuard] },
  { path: 'outlet', component: OutletPickComponent, canActivate: [signedInGuard] },
  { path: 'form-preview/:id', component: ApplyComponent },
  { path: 'apply/:slug', component: ApplyComponent },
  { path: 'careers/:company/:code', component: CareerComponent },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', component: HomeComponent, canDeactivate: [(home: HomeComponent) => home.mayLeave()] },
      { path: 'attendance', component: AttendanceComponent },
      { path: 'exceptions', component: ExceptionsComponent, canActivate: [featureGuard('exceptions')] },
      { path: 'leave', component: LeaveComponent },
      { path: 'news', component: NewsComponent },
      { path: 'notifications', component: NotificationsComponent },
      { path: 'requests', component: RequestsComponent },
      { path: 'recognition', component: RecognitionComponent },
      { path: 'growth', component: GrowthComponent },
      { path: 'jobs', component: JobsComponent },
      { path: 'library', component: LibraryComponent },
      { path: 'profile', component: ProfileComponent },
      { path: 'manual', component: ManualComponent },
      { path: 'approvals', component: ApprovalsComponent, canActivate: [featureGuard('approvals')] },
      { path: 'team', component: TeamComponent, canActivate: [featureGuard('approvals')] },
      { path: 'reporting', component: ReportingComponent },
      { path: 'people', component: PeopleComponent, canActivate: [featureGuard('people')] },
      { path: 'people/import', component: PeopleImportComponent, canActivate: [featureGuard('people.edit')] },
      { path: 'assets', component: AssetsComponent },
      { path: 'hiring', component: HiringComponent, canActivate: [featureGuard('hiring')] },
      { path: 'vendors', component: VendorsComponent, canActivate: [featureGuard('hiring')] },
      { path: 'hiring/applications', component: ApplicationsComponent, canActivate: [featureGuard('hiring')] },
      { path: 'hiring/applications/:id', component: ApplicationComponent, canActivate: [featureGuard('hiring')] },
      { path: 'hiring/new', component: OpeningComponent, canActivate: [featureGuard('hiring')] },
      { path: 'hiring/:id', component: OpeningComponent, canActivate: [featureGuard('hiring')] },
      { path: 'people/:id', component: PersonComponent },
      { path: 'organisation', component: OrganisationComponent, canActivate: [featureGuard('people')] },
      { path: 'pay', component: PayComponent },
      { path: 'tax', component: TaxComponent },
      { path: 'choice-pay', component: ChoicePayComponent },
      { path: 'rewards', component: RewardsComponent },
      { path: 'separation', component: SeparationComponent },
      { path: 'performance', component: PerformanceComponent },
      { path: 'surveys', component: SurveysComponent },
      { path: 'succession', component: SuccessionComponent, canActivate: [featureGuard('succession')] },
      { path: 'payroll', component: PayrollComponent, canActivate: [featureGuard('pay')] },
      { path: 'settings', component: SettingsComponent, canActivate: [featureGuard('settings')] },
      { path: 'system', component: SystemComponent, canActivate: [featureGuard('owner')] },
      { path: 'reports', component: ReportsComponent, canActivate: [featureGuard('reports')] },
    ],
  },
  { path: '**', redirectTo: '' },
];
