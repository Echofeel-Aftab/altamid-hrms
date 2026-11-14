/** Who the manual is written for. Every section and how-to is filtered against this. */
export interface ManualReader {
  keys: Set<string>;
  role: string;
  owner: boolean;
  /** The sign-in is linked to a person record, so self-service pages work. */
  person: boolean;
  /** Master sign-in that can manage outlets. */
  master: boolean;
  /** Payroll runs for this outlet (India outlets only). */
  payroll: boolean;
  /** Approvals and exceptions cover only the reader's own reporting line. */
  teamScope: boolean;
}

type When = (reader: ManualReader) => boolean;

export interface ManualHowTo {
  title: string;
  body?: string;
  steps?: string[];
  when?: When;
}

export interface ManualSection {
  id: string;
  group: string;
  title: string;
  path?: string;
  menu?: string;
  why: string;
  example?: string;
  tips?: string[];
  howTo: ManualHowTo[];
  when?: When;
}

const has = (key: string): When => (reader) => reader.owner || reader.keys.has(key);
const any = (...keys: string[]): When => (reader) => keys.some((key) => has(key)(reader));
const all = (...checks: When[]): When => (reader) => checks.every((check) => check(reader));
const linked: When = (reader) => reader.person;
const ownerOnly: When = (reader) => reader.owner;
const master: When = (reader) => reader.master;
const payroll: When = (reader) => reader.payroll;

export const MANUAL_GROUPS = ['Start here', 'My day', 'My team', 'Company', 'Pay', 'Hiring', 'Setup'];

export const MANUAL: ManualSection[] = [
  {
    id: 'getting-started',
    group: 'Start here',
    title: 'Getting started',
    path: '/login',
    why: 'This manual is written for your sign-in. It lists only the screens and actions your role and access allow, so anything you cannot open is left out on purpose. When HR changes your access, download a fresh copy.',
    howTo: [
      {
        title: 'Sign in',
        steps: [
          'Open the HRMS address your company shared and choose Sign in.',
          'Enter your Work email and Password, then choose Sign in.',
          'If your company has more than one outlet, choose the outlet you are working in. Master sign-ins can also choose All outlets.',
          'Five wrong passwords in a row pause sign-in for 15 minutes.',
        ],
      },
      {
        title: 'Forgot your password',
        steps: [
          'On the sign-in page choose Forgot password?.',
          'Enter your Work email and choose Email me a link.',
          'Open the email, choose the link within 30 minutes, then type the new password twice and choose Set password.',
        ],
      },
      {
        title: 'Change your password',
        steps: [
          'Open your name at the top right and choose Password.',
          'Enter the Current password and a New password of at least 8 characters with a letter and a number.',
          'Choose Update password.',
        ],
      },
      {
        title: 'Find your way around',
        body: 'The left sidebar shows only the screens you can open, grouped as My day, My team and Company. The top bar holds search, the outlet switcher, language, light or dark theme, notifications and your account menu.',
        steps: [
          'Type in Search anything in HRMS... to jump to a screen. People appear in the results when you can open the directory.',
          'Use the translate button to pick a language. Menus, search and notifications follow it.',
          'Use the sun or moon button to switch between light and dark theme. The choice is kept on this device.',
          'Collapse the sidebar with the arrow at its foot when you need more room.',
          'Messages after you save or when something fails appear at the bottom right and close by themselves.',
        ],
      },
      {
        title: 'Download this manual again',
        steps: [
          'Open your name at the top right and choose User manual.',
          'Choose Download PDF to save it, or Print for a paper copy.',
        ],
      },
    ],
  },
  {
    id: 'notifications',
    group: 'Start here',
    title: 'Notifications',
    path: '/notifications',
    menu: 'Top bar › bell',
    why: 'The bell collects what needs you: decisions on your requests, items waiting for approval, announcements and reminders.',
    howTo: [
      {
        title: 'Read and clear notifications',
        steps: [
          'Choose the bell at the top. The red count shows unread items.',
          'Use the tabs to filter, then choose an item to open the screen it points to. It is marked read.',
          'Choose Mark all read to clear the count, or View all to open the full list.',
        ],
      },
    ],
  },
  {
    id: 'modules',
    group: 'Start here',
    title: 'All modules and pinned pages',
    menu: 'Top bar › grid',
    why: 'The grid button at the top opens every module you can use, grouped as in the menu, with a search. Pin the pages you use most and they stay at the top of the menu under Pinned.',
    howTo: [
      {
        title: 'Find and pin a module',
        steps: [
          'Choose the grid button next to the language button.',
          'Type part of a name, such as tax or survey. Press Enter to open the first match.',
          'Choose the pin on a tile to pin or unpin it. You can pin up to 12 pages.',
        ],
      },
    ],
  },
  {
    id: 'home',
    group: 'My day',
    title: 'Home',
    path: '/',
    menu: 'My day › Home',
    why: 'Home is your day at a glance: your check-in, what is waiting on you, leave left, birthdays, announcements and shortcuts. The boxes follow your access, so HR and managers see their desks here too.',
    example: 'You open Home at 9:30, see "Waiting on you: 2", choose it and approve two leave requests without hunting through menus.',
    howTo: [
      {
        title: 'Use the top banner',
        steps: [
          'Read the greeting line. It tells you whether you are checked in and what needs you.',
          'Choose a tile such as Waiting on you, Present this month or Leave days left to open that screen.',
        ],
      },
      {
        title: 'Find a colleague',
        when: has('people'),
        steps: ['Type a name or employee code in the search on the banner.', 'Choose Open on the person to see their profile.'],
      },
      {
        title: 'Arrange your Home',
        steps: [
          'Choose Edit my Home.',
          'Drag boxes into the order you like, hide the ones you do not need, or add hidden ones back.',
          'Choose Save my Home. Company default puts back the layout HR set for you.',
          'If you leave with unsaved changes, HRMS asks before throwing them away.',
        ],
      },
      {
        title: 'Set Home layouts for others',
        when: any('settings', 'library'),
        steps: ['Choose Home layouts for roles and people, or open Settings › Home layouts.', 'See the Home layouts section of this manual for the steps.'],
      },
    ],
  },
  {
    id: 'check-in',
    group: 'My day',
    title: 'Check in and check out',
    path: '/attendance',
    menu: 'Home › Check-in card, or My day › Attendance',
    when: linked,
    why: 'Your check-in records when your day starts and ends. Payroll and attendance reports read from it, so a missed check-out shows up as an exception.',
    tips: [
      'If your company checks location, allow location when the browser asks. You must be inside the allowed area.',
      'A note can be up to 200 characters.',
    ],
    howTo: [
      {
        title: 'Start and end your day',
        steps: [
          'On Home or Attendance choose Check in. HRMS shows Finding you... while it reads your location, if your company asks for it.',
          'The card shows your shift, the time you came in and a running timer. If you arrive after the grace time it shows Late by.',
          'At the end of the day choose Check out.',
          'Choose Add a note on Attendance to leave a short note with a punch.',
        ],
      },
      {
        title: 'You forgot to check out',
        body: 'The card shows "Yesterday\'s check-out was missed. Regularize it from Attendance." Send a Regularize request for that day so your manager can correct it.',
      },
    ],
  },
  {
    id: 'attendance',
    group: 'My day',
    title: 'Attendance',
    path: '/attendance',
    menu: 'My day › Attendance',
    why: 'Attendance shows your month day by day and is where you ask for corrections, extra time, work from home or on-duty days. Approved requests update the calendar and feed payroll.',
    example: 'You were at a client site all Tuesday. Select Tuesday, choose On duty, add the place and reason, and choose Send for approval.',
    tips: [
      'Requests must be within 60 days of today.',
      'Regularize and Extra time are only for days that have already started.',
      'Extra time is 0.5 to 12 hours, in half-hour steps.',
      'Work from home cannot be on a weekly off or holiday.',
    ],
    howTo: [
      {
        title: 'Read your month',
        steps: ['Use Previous and Next to move between months.', 'Each day shows Present, Leave, On duty, Holiday, Week off, Missed check-out and so on.'],
      },
      {
        title: 'Send a request from the calendar',
        when: linked,
        steps: [
          'Choose one or more days on the calendar. Choose Clear to start again.',
          'Pick Apply leave, Regularize, Extra time, Work from home or On duty.',
          'Fill in the times, place or reason the form asks for.',
          'Choose Send for approval (or Submit leave). Your manager is told straight away.',
          'Days that are not next to each other become one request per day.',
        ],
      },
      {
        title: 'Manage company holidays',
        when: has('attendance'),
        steps: ['In Company holidays choose Add holiday, pick the date and name it.', 'Choose Remove beside a holiday to take it off. Calendars and leave counts update for everyone.'],
      },
      {
        title: 'Connect punch readers',
        when: has('attendance.devices'),
        steps: [
          'In Readers choose Connect and give the fingerprint, face or card reader a name.',
          'Copy the details shown into the reader, or into its software.',
          'Choose Remove to disconnect a reader that is no longer used.',
        ],
      },
      {
        title: 'Watch live punches',
        when: has('attendance.live'),
        body: 'Who is in lists the latest punches from the web, phones and readers across the company as they arrive.',
      },
    ],
  },
  {
    id: 'leave',
    group: 'My day',
    title: 'Leave',
    path: '/leave',
    menu: 'My day › Leave',
    why: 'Leave shows how many days you have left of each type and is where you apply. Weekly offs and holidays inside your dates are not counted.',
    example: 'You need Friday and Monday off. Choose Casual leave, From Friday, To Monday. HRMS counts 2 days because the weekend is off.',
    tips: ['A half day is for one working day only, so From and To must be the same day.', 'You can cancel a request while it is still pending.'],
    howTo: [
      {
        title: 'Check your balance',
        body: 'Each leave type shows days entitled, taken and left. Types marked Open have no yearly limit.',
      },
      {
        title: 'Apply for leave',
        when: linked,
        steps: [
          'Choose the leave Type.',
          'Pick From and To dates, or tick Half day, one working day.',
          'Add a Reason and choose Submit request.',
          'Your manager is told. The decision appears in Your requests and in the bell.',
        ],
      },
      {
        title: 'Cancel a request',
        when: linked,
        steps: ['In Your requests find the pending request.', 'Choose Cancel.'],
      },
    ],
  },
  {
    id: 'requests',
    group: 'My day',
    title: 'My requests',
    path: '/requests',
    menu: 'My day › Requests',
    when: linked,
    why: 'My transaction history: everything you have asked for, such as leave, attendance, pay detail changes, resignation, tax declaration and choice pay, with where each one is now and who approved each step.',
    example: 'Your work from home for Monday says "waiting for Divya Rao (step 2 of 2), after approval by Nikhil Shah". Your team lead has approved it and HR is next.',
    howTo: [
      {
        title: 'Find a request',
        steps: [
          'Choose a type on the left, such as Leave or Time and attendance. The number is how many you sent, and the amber number is how many are waiting.',
          'Choose This year, Last year, or Custom and pick the dates.',
          'Choose a status tab: All, Draft, Pending, Cancelled, Approved or Rejected.',
          'Type in Search to find a request by type, date or approver.',
        ],
      },
      {
        title: 'See who approved it',
        steps: [
          'Choose View on the row.',
          'Read the details and your remarks.',
          'Under Approval process, each step shows who approves it and whether it is Approved, Waiting, Next or Declined.',
          'Point at or choose an approver to see their designation, contact number and email.',
        ],
      },
      { title: 'Cancel a request', steps: ['Choose Cancel on a pending row, or Cancel request in View.', 'Confirm. The approvers no longer see it.'] },
    ],
  },
  {
    id: 'news',
    group: 'My day',
    title: 'Announcements',
    path: '/news',
    menu: 'My day › Announcements',
    why: 'Company news in one place, with the important posts pinned at the top.',
    howTo: [
      { title: 'Read announcements', body: 'Newest posts come first. Pinned posts stay at the top until they expire or are unpinned.' },
      {
        title: 'Post an announcement',
        when: has('news'),
        steps: [
          'Choose Post an announcement.',
          'Write the Title and Message (up to 4,000 characters).',
          'Choose Who sees it: Everyone, One department or One location.',
          'Optionally set Expires and tick Pin to the top.',
          'Choose Post. If email is set up, an announcement email can go out too.',
        ],
      },
    ],
  },
  {
    id: 'reporting',
    group: 'My day',
    title: 'Reporting line',
    path: '/reporting',
    menu: 'My day › Reporting line',
    why: 'See who you report to, your team lead, your peers and the people who report to you.',
    howTo: [
      {
        title: 'Browse the line',
        steps: [
          'Choose any person in the tree to see their own line.',
          'Choose +N more to open a long list of peers.',
          'Choose Back to me to return to your own line.',
        ],
      },
      { title: 'Open a profile', when: has('people'), body: 'Choose Open profile on the highlighted person to see their full record.' },
    ],
  },
  {
    id: 'recognition',
    group: 'My day',
    title: 'Recognition',
    path: '/recognition',
    menu: 'My day › Recognition',
    why: 'Thank a colleague with a badge. Badges show in the live feed, on the leaderboard and on the person\'s Home.',
    howTo: [
      {
        title: 'Give a badge',
        steps: [
          'Type at least 2 letters of the Colleague\'s name and pick them.',
          'Pick a badge and add a short Note (up to 180 characters).',
          'Choose Give a badge.',
        ],
      },
      { title: 'See the leaderboard', body: 'Pick This week, This month or All time to see the Top receiver and Top giver.' },
    ],
  },
  {
    id: 'jobs',
    group: 'My day',
    title: 'Jobs and referrals',
    path: '/jobs',
    menu: 'My day › Jobs',
    why: 'Open roles inside the company. Apply for a move yourself, or refer someone you know.',
    howTo: [
      { title: 'Apply for an internal job', steps: ['Open the job.', 'Choose Apply. HR sees your application in Hiring.'] },
      {
        title: 'Refer someone',
        steps: ['Choose Refer someone on the job.', 'Enter the Candidate name, Email and Why they fit.', 'Choose Send referral. Follow it under Yours.'],
      },
    ],
  },
  {
    id: 'library',
    group: 'My day',
    title: 'Library',
    path: '/library',
    menu: 'My day › Library',
    why: 'The employee handbook, policies, help articles and letters shared with you.',
    howTo: [
      { title: 'Read documents', steps: ['Choose Open the handbook or Preview on any document.', 'Letters meant only for you are visible only to you, HR and the owner.'] },
      {
        title: 'Publish and share documents',
        when: has('library'),
        steps: [
          'Choose Publish handbook to upload the current handbook PDF. It replaces the older one.',
          'Choose Publish article for a help page, or Share document for a PDF.',
          'Pick who may open it: Everyone, managers, HR, one person, a department or a location.',
          'Use Show or Hide to control visibility, and Remove to delete it.',
          'Choose Save who can see this after changing the audience.',
        ],
      },
    ],
  },
  {
    id: 'my-pay',
    group: 'My day',
    title: 'My pay',
    path: '/pay',
    menu: 'My pay › My pay',
    when: linked,
    why: 'Your published CTC, monthly salary slips and Form 16. You see only what payroll has published for you.',
    howTo: [
      {
        title: 'Read your salary slip',
        steps: ['Open CTC breakup for your yearly package.', 'In Monthly breakup choose a month to read the slip and the Net pay.'],
      },
      { title: 'Download Form 16', steps: ['In Form 16 choose Preview.', 'Download it from the preview window.'] },
    ],
  },
  {
    id: 'my-growth',
    group: 'My day',
    title: 'My Growth',
    path: '/growth',
    menu: 'Talent › My Growth',
    when: (reader) => reader.person || reader.role === 'hr' || reader.role === 'manager' || reader.owner,
    why: 'A career chart from the year you joined, and a history of each appraisal: the grade and the CTC breakup. A team lead publishes for people who report to them. HR publishes for anyone. The person sees a year only after it is published.',
    tips: ['The team lead is the reporting manager on the person, even when their sign-in role is not Manager.'],
    howTo: [
      {
        title: 'Read your chart',
        when: linked,
        steps: [
          'Open My Growth.',
          'The line starts at Joined and rises to each published grade.',
          'Career history lists the year, grade, designation and annual CTC. Open CTC breakup for that year\'s lines.',
        ],
      },
      {
        title: 'Publish an appraisal',
        when: (reader) => reader.role === 'manager' || reader.role === 'hr' || reader.owner,
        steps: [
          'Open My Growth and choose the person. A team lead sees people who report to them. HR sees everyone.',
          'Enter the appraisal year, the grade, the designation and the CTC lines. Use current CTC copies the published package.',
          'Save draft while you are still working. Publish when they should see the grade and the breakup.',
        ],
      },
    ],
  },
  {
    id: 'tax',
    group: 'My day',
    title: 'Tax and investments',
    path: '/tax',
    menu: 'My pay › Tax and investments',
    when: (reader) => reader.person || has('pay.tax')(reader),
    why: 'Choose the old or new tax regime, declare what you plan to invest, upload proofs, and see the tax for the year before payroll deducts it. The tax simulator lets you try figures without saving anything.',
    example: 'Kavya pays ₹8,000 rent in Kolkata and puts ₹1 lakh in PPF. The page shows tax under both regimes, so she sees whether the old regime saves her anything.',
    tips: [
      'The page starts from your published CTC and the tax already deducted on your published slips.',
      'Under the new regime most deductions do not apply. You can still fill them in to compare.',
      'Rent above ₹1 lakh a year needs the landlord’s PAN.',
    ],
    howTo: [
      {
        title: 'Declare your investments',
        when: linked,
        steps: [
          'Open Tax and investments. Choose a regime. The card marked Saves you more is cheaper on your figures.',
          'Fill in rent, 80C, health insurance and any other items you plan.',
          'Save draft, then Send to payroll.',
          'After saving once, choose Proof next to an item to upload a PDF, JPG or PNG.',
        ],
      },
      { title: 'Try figures in the simulator', steps: ['Open the Tax simulator tab.', 'Change salary, rent or investments. Old against new updates as you type.'] },
      {
        title: 'Check declarations as payroll',
        when: has('pay.tax'),
        steps: [
          'Open the Payroll desk tab. Set the declaration and proof windows at the top.',
          'Choose Review on a person. Check each proof, lower an amount if a proof covers less, then Approve or Send back with a note.',
          'Approving sets the person’s tax regime on file and tells them.',
        ],
      },
    ],
  },
  {
    id: 'choice-pay',
    group: 'My day',
    title: 'Choice pay',
    path: '/choice-pay',
    menu: 'My pay › Choice pay',
    when: (reader) => reader.person || has('pay.flex')(reader),
    why: 'Split the flexible part of your CTC, such as Special allowance, across allowances like fuel, phone and meals. Under the old regime these are tax free when you give bills, and the approved split counts in your tax estimate.',
    howTo: [
      {
        title: 'Choose your split',
        when: linked,
        steps: ['Open Choice pay while payroll has it open.', 'Move each slider or type an amount, up to the yearly limit.', 'Send to payroll. Anything you do not split is paid as taxable allowance.'],
      },
      {
        title: 'Set up and approve choice pay',
        when: has('pay.flex'),
        steps: [
          'Open Set up. Add the allowances and their yearly limits, and the words that find the flexible line in a CTC.',
          'Turn on Open for people to choose.',
          'In Payroll desk choose Review, then Approve or Send back with a note.',
        ],
      },
    ],
  },
  {
    id: 'total-rewards',
    group: 'My day',
    title: 'Total rewards',
    path: '/rewards',
    menu: 'My pay › Total rewards',
    when: (reader) => reader.person || has('pay.rewards')(reader),
    why: 'Everything you get for your work in one statement: cash pay, what the company pays for you such as PF, benefits like insurance, and the value of your paid leave.',
    howTo: [
      { title: 'Download your statement', when: linked, steps: ['Open Total rewards.', 'Choose Statement PDF, then download it from the preview.'] },
      {
        title: 'Add company benefits',
        when: has('pay.rewards'),
        steps: ['Open Benefits setup.', 'Add each benefit with its yearly cost per person, or 0 to show Included.', 'Save. Every statement shows them at once. Use the person picker to read anyone’s statement.'],
      },
    ],
  },
  {
    id: 'performance',
    group: 'My day',
    title: 'Performance',
    path: '/performance',
    menu: 'Talent › Performance',
    when: (reader) => reader.person || has('performance')(reader),
    why: 'Each review cycle has three phases. In Goal setting you add weighted goals. In Review you rate each goal and write a summary, then your manager does the same. When HR closes the cycle you can read the final rating.',
    example: 'Close 40 deals (60%) and Mentor two juniors (40%). Kavya rates both 4 of 5, her manager rates them 3, and the final rating is 3.',
    tips: ['Goal weights should add up to 100.', 'You cannot change your self review after you send it.'],
    howTo: [
      {
        title: 'Set your goals and track progress',
        when: linked,
        steps: ['Open Performance › My goals during Goal setting.', 'Add a goal with a measure of success and a weight.', 'Move the progress slider during the year.'],
      },
      { title: 'Send your self review', when: linked, steps: ['In the Review phase, rate each goal and add a note.', 'Give an overall rating and a short summary.', 'Send review. Your manager is told.'] },
      { title: 'Review your team', when: (reader) => reader.role === 'manager' || has('performance')(reader), steps: ['Open My team and choose Open on a person.', 'Rate each goal, write a summary for them, then Send review.'] },
      {
        title: 'Run a review cycle',
        when: has('performance'),
        steps: [
          'Choose New review cycle. Set the name, dates and rating scale.',
          'Move the cycle through Goal setting, Review and Closed. Everyone is told at each step.',
          'In Everyone open a person to set a calibrated final rating. Closing uses the manager rating where none is set.',
        ],
      },
    ],
  },
  {
    id: 'surveys',
    group: 'My day',
    title: 'Surveys',
    path: '/surveys',
    menu: 'Talent › Surveys',
    why: 'Quick pulse checks and engagement surveys. In an anonymous survey your name is never saved with your answers, and results stay hidden until at least three people answer.',
    howTo: [
      { title: 'Answer a survey', when: linked, steps: ['Open Surveys › For me.', 'Choose Answer, fill in the questions marked * and Send answers.'] },
      {
        title: 'Create and run a survey',
        when: has('surveys'),
        steps: [
          'Choose New survey. Use the pulse template or add questions: ratings, a 0 to 10 score, pick one, pick several, yes or no, or a written answer.',
          'Choose who it is for, and a closing date.',
          'Save and open. Everyone it is for gets a notification.',
          'In Manage choose Results for answer counts, averages, eNPS and written answers.',
        ],
      },
    ],
  },
  {
    id: 'separation',
    group: 'My day',
    title: 'Separation',
    path: '/separation',
    menu: 'My day › Separation',
    when: (reader) => reader.person || has('exits')(reader),
    why: 'Resign and follow each step of your exit: acceptance, the handover checklist, the exit interview, the full and final settlement and your relieving and experience letters.',
    tips: ['You can take back a resignation while it is still waiting.', 'Your letters open after your last working day.'],
    howTo: [
      { title: 'Resign', when: linked, steps: ['Open Separation. Check the suggested last working day, which follows the notice period.', 'Add a short reason and Send resignation.'] },
      { title: 'Send your exit interview', when: linked, steps: ['After your resignation is accepted, fill in the exit interview on the Separation page and Send.'] },
      {
        title: 'Run the exits desk',
        when: has('exits'),
        steps: [
          'Open Exits desk. Choose Start an exit for a resignation by email or when the company ends the employment.',
          'Open an exit to accept or decline it, change the last day, or waive the notice. A reason is kept in its history.',
          'Tick checklist items as they are done. Ticking an asset item puts the asset back in stock.',
          'Check the suggested full and final lines (salary for days worked, leave encashment, gratuity, notice shortfall), edit them, and Make final.',
          'Download the relieving, experience and settlement letters. On or after the last day choose End employment.',
        ],
      },
    ],
  },
  {
    id: 'my-profile',
    group: 'My day',
    title: 'My profile and my details',
    path: '/profile',
    menu: 'Top right › My profile',
    when: linked,
    why: 'Everything about you in one place: work details, personal details, documents, pay, growth, time off, requests, assets, your access and resignation.',
    tips: [
      'Name, date of birth, gender and work email can be changed only by HR.',
      'PAN, Aadhaar, UAN, ESIC, bank and tax regime changes wait for HR or payroll approval before they are used.',
    ],
    howTo: [
      {
        title: 'Keep your details up to date',
        steps: [
          'Choose Update my details, or open the My details tab.',
          'Fill Photo, Personal, Address, Emergency and nominee and Statutory and bank.',
          'Tick Permanent address is the same if it matches your current address.',
          'Choose Review changes, check the list, then choose Approve and save.',
          'Changes that need approval show as pending. Choose Withdraw to take one back.',
        ],
      },
      { title: 'Change your photo', steps: ['Choose the camera on your picture.', 'Pick a JPG or PNG. HRMS crops it square.'] },
      { title: 'See your documents and assets', body: 'My documents lists letters and files shared with you. My assets lists the laptop, phone or ID card issued to you.' },
      {
        title: 'Resign',
        steps: ['Open the Work tab.', 'Choose your last day. HRMS suggests it from the notice period.', 'Choose Review resignation, then Approve and send. You can cancel while it is pending.'],
      },
    ],
  },
  {
    id: 'my-assets',
    group: 'My day',
    title: 'Assets issued to you',
    path: '/assets',
    menu: 'Company › Assets',
    when: (reader) => !has('assets')(reader),
    why: 'See the laptop, phone, ID card or other items the company has issued to you.',
    howTo: [{ title: 'Read your items', body: 'Each card shows the item, serial number and date issued. Choose Reveal or Copy for a stored password or code when HR allows it.' }],
  },
  {
    id: 'my-team',
    group: 'My team',
    title: 'My team',
    path: '/team',
    menu: 'My team › My team',
    when: has('approvals'),
    why: 'Your reporting tree with today\'s in and out counts and what is waiting for your decision.',
    howTo: [
      {
        title: 'Check your team today',
        steps: [
          'Read People, In today, Out today and Waiting on you.',
          'Browse The line under you. It includes the teams of your team leads.',
          'Choose Open approvals to decide what is waiting.',
        ],
      },
    ],
  },
  {
    id: 'approvals',
    group: 'My team',
    title: 'Approvals',
    path: '/approvals',
    menu: 'My team › Approvals',
    when: has('approvals'),
    why: 'Decide leave, attendance requests and resignations in one queue. Each decision is sent to the person and updates their calendar.',
    example: 'Asha asked to regularize Monday because she forgot to check out. Check the times, then choose Approve. Her Monday turns Present.',
    howTo: [
      {
        title: 'Decide leave and attendance',
        steps: [
          'Open the Leave or Attendance table.',
          'Read the dates, times and reason. Step shows where the request is, such as Step 1 of 2 · Reporting manager.',
          'Choose Approve or Reject on the row.',
          'When there is a next step, your approval passes it on, for example to HR, and the person is told. The last approval decides it.',
        ],
      },
      { title: 'Decide resignations', steps: ['In Resignation check the last day.', 'Choose Accept or Decline. By default HR accepts after the reporting manager.'] },
      {
        title: 'Who sees a request',
        body: 'You see a request only when its current step waits on you. Owners and anyone with company-wide approvals see every request and can decide at any step; the person sees that as an override. Settings › More › Approval flows sets the steps.',
      },
      {
        title: 'Approve pay detail changes',
        when: any('people.edit', 'pay'),
        steps: [
          'In Pay detail changes open the person and compare the old and new PAN, bank or tax details.',
          'Choose Approve, or type a Reason, needed to reject and choose Reject.',
          'Your own changes must be approved by someone else in HR or payroll.',
        ],
      },
      {
        title: 'Whose requests you see',
        when: (reader) => reader.teamScope,
        body: 'Your role covers your own reporting line, so you see requests only from people who report to you.',
      },
    ],
  },
  {
    id: 'exceptions',
    group: 'My team',
    title: 'Exceptions',
    path: '/exceptions',
    menu: 'My day › Exceptions',
    when: has('exceptions'),
    why: 'One list of who came late, left early, did not punch, did not punch out or is not in yet, so problems are fixed before payroll.',
    tips: ['Approved leave, work from home, on duty, weekly offs and holidays are left out.', 'Late is counted after the shift grace time.'],
    howTo: [
      {
        title: 'Review a day',
        steps: [
          'Pick the Day.',
          'Use Show to filter: All exceptions, Late, Left early, No punch, No punch out or Not in yet.',
          'Choose a name to open the person and follow up.',
        ],
      },
    ],
  },
  {
    id: 'people',
    group: 'Company',
    title: 'People directory',
    path: '/people',
    menu: 'Company › People',
    when: has('people'),
    why: 'The company directory. Search anyone and open their profile.',
    tips: ['The list shows the first 100 people. Search to find anyone in a larger company.'],
    howTo: [
      { title: 'Find someone', steps: ['Type a name, code or department in Search.', 'Filter by department or status.', 'Choose the person to open the profile.'] },
      {
        title: 'Add a person',
        when: has('people.edit'),
        steps: [
          'Choose Add a person.',
          'Fill Identity, Job, Dates, Personal, Address and Pay details.',
          'Under Sign-in decide whether they can sign in and with which role.',
          'Choose Add person.',
        ],
      },
      {
        title: 'Import many people',
        when: has('people.edit'),
        steps: [
          'Choose Import, then Download CSV template.',
          'Fill one row per person. First name is required. Dates can be 2026-04-01 or 01/04/2026.',
          'Choose the file, tick Add missing departments, designations and locations if needed, then choose Check rows.',
          'Fix any row with a problem, then choose Import. People arrive active, without sign-in.',
          'Up to 500 rows and 2 MB per file.',
        ],
      },
    ],
  },
  {
    id: 'person',
    group: 'Company',
    title: 'Employee profile',
    path: '/people',
    menu: 'Company › People › a person',
    when: has('people'),
    why: 'One person\'s full record. The cover shows today\'s attendance, a coming birthday or anniversary, probation status and how complete the profile is.',
    howTo: [
      { title: 'Read the profile', body: 'Overview shows work and contact details. Reports to on the cover opens the manager\'s profile.' },
      {
        title: 'Edit details',
        when: has('people.edit'),
        steps: [
          'Choose Edit details.',
          'Change what you need. Pay details are stored encrypted.',
          'Choose Review changes. Check each before and after, then choose Approve and save, or Discard changes.',
        ],
      },
      {
        title: 'Run onboarding',
        when: has('people.edit'),
        steps: ['Open the Onboarding tab.', 'Tick each task as it is done, or choose Add a task.', 'Choose Open checklist from Overview to jump back here.'],
      },
      {
        title: 'Change this person\'s access',
        when: has('access'),
        steps: [
          'Open the Access tab. Each area shows whether it comes from the Role, Department, Grade or This person.',
          'Switch the Department, Grade or This person columns on or off.',
          'Choose Save this person\'s access. Department and grade changes apply to everyone in them.',
        ],
      },
    ],
  },
  {
    id: 'succession',
    group: 'Company',
    title: 'Succession planning',
    path: '/succession',
    menu: 'Company › Succession',
    when: has('succession'),
    why: 'Name the roles you cannot afford to leave empty, the person in each now, who could step in and how soon. The risk and impact grid shows which roles need a successor first.',
    howTo: [
      {
        title: 'Add a key role',
        steps: [
          'Choose Add a key role. Enter the role and the person in it.',
          'Set the impact if they leave and the risk of losing them.',
          'Add successors with Ready now, in 1 to 2 years, or in 3+ years, and what each still needs.',
        ],
      },
    ],
  },
  {
    id: 'organisation',
    group: 'Company',
    title: 'Organisation',
    path: '/organisation',
    menu: 'Company › Organisation',
    when: has('people'),
    why: 'The org chart, headcount, the role ladder and the master lists everyone picks from: departments, designations, locations, grades and teams.',
    howTo: [
      { title: 'Read the chart', body: 'The Reporting line chart shows up to about 400 people. Use People search in larger companies.' },
      {
        title: 'Maintain the lists',
        when: has('people.edit'),
        steps: [
          'Under Departments, Designations, Locations, Grades or Teams type a name and choose Add.',
          'Pick a Team lead for each team.',
          'In Ladder add a Role and choose Company or Own team scope, then Add role.',
        ],
      },
    ],
  },
  {
    id: 'assets',
    group: 'Company',
    title: 'Assets',
    path: '/assets',
    menu: 'Company › Assets',
    when: has('assets'),
    why: 'A register of company laptops, phones, ID cards and other items, with who has each one and its full history.',
    tips: ['New items go to stock first, then you issue them.', 'An item that was ever issued cannot be removed, only retired or marked lost.'],
    howTo: [
      { title: 'Add an asset', steps: ['Choose Add an asset.', 'Fill the kind, name, serial, cost, vendor and warranty.', 'Choose Add to stock.'] },
      { title: 'Issue an asset', steps: ['Open the asset.', 'Choose Issue to someone, pick the person and choose Issue.'] },
      {
        title: 'Take it back',
        steps: ['Open the asset and choose Take it back.', 'Pick the Condition on return. Damaged sends it to repair.'],
      },
      { title: 'Other changes', body: 'Use Send for repair, Back in stock, Retire or Mark lost. Stats show totals and warranties ending in 30 days.' },
    ],
  },
  {
    id: 'hiring',
    group: 'Hiring',
    title: 'Hiring and job openings',
    path: '/hiring',
    menu: 'Company › Hiring',
    when: has('hiring'),
    why: 'Create jobs, publish them on the company website and job portals, and collect every application in one place.',
    example: 'Choose New job, write the Sales executive role, choose Open this job, then paste its apply address into Naukri and LinkedIn.',
    howTo: [
      {
        title: 'Create and open a job',
        steps: [
          'Choose New job.',
          'Fill The job: title, Openings, department, location, Workplace, Employment, Description and Requirements.',
          'Tick Employees can apply or Employees can refer someone to show it on Jobs.',
          'Choose Save, then Open this job to start taking applications.',
          'Choose Close applications when you are done. Existing applications stay.',
        ],
      },
      {
        title: 'Post on job portals',
        steps: [
          'In Where this job is posted tick the portals.',
          'Copy the apply address and paste it into each portal.',
          'On Hiring, Job portals gives a Job feed and XML feed for portals that read feeds. Add ?portal=naukri (or linkedin, indeed and the others) to list only that portal\'s jobs.',
          'Replace the feed address stops the old address working until you update it on the portals.',
        ],
      },
    ],
  },
  {
    id: 'applications',
    group: 'Hiring',
    title: 'Applications',
    path: '/hiring/applications',
    menu: 'Company › Hiring › Applications',
    when: has('hiring'),
    why: 'Every candidate from the website, forms and portals, with a match score against the job description.',
    tips: ['The match score is a word match to help you sort. It is not a hiring decision.', 'A hired candidate is not added to People until you choose Add as employee.'],
    howTo: [
      { title: 'Work the list', steps: ['Filter by status, job or source.', 'Choose Details to open a candidate.'] },
      {
        title: 'Review a candidate',
        steps: [
          'Read the Resume, What they told us and Files and source.',
          'Choose Match with the job description, or paste the resume text and choose Save and score.',
          'Set the Status (Reviewing, Shortlisted, Interview, Rejected or Hired), add a Note for HR and choose Save.',
        ],
      },
      { title: 'Hire', when: has('people.edit'), steps: ['Set the status to Hired.', 'Choose Add as employee. The new person form opens already filled.'] },
      { title: 'Set reapply rules', steps: ['Choose Reapply rules.', 'Set how many days after a rejection or exit someone may apply again, and the reply they get.', 'Choose Save rules.'] },
    ],
  },
  {
    id: 'job-forms',
    group: 'Hiring',
    title: 'Job forms and website embed',
    path: '/settings',
    menu: 'Settings › Forms',
    when: all(has('hiring.forms'), has('settings')),
    why: 'Build application forms with your own fields and put them on any website. Applications arrive in Hiring.',
    tips: ['Full name and email are always on the form.', 'Files can be up to 5 MB each and 12 MB in total.'],
    howTo: [
      {
        title: 'Build a form',
        steps: [
          'Open Settings › Forms, filter premade templates (General, Campus, Specialist, Events), then Create form.',
          'On Your forms, choose Preview to see the form as an iframe embed or a full website page before publishing.',
          'In the editor, use Preview with Form only or Full page, then fill Page text and After sending.',
          'Choose Save and publish.',
        ],
      },
      {
        title: 'Put it on a website',
        steps: ['In Public link and embed choose Form only or Full page.', 'Copy the code and paste it into the website page.'],
      },
    ],
  },
  {
    id: 'vendors',
    group: 'Hiring',
    title: 'Vendors and agencies',
    path: '/vendors',
    menu: 'Company › Vendors',
    when: has('hiring'),
    why: 'Keep the agencies you hire through and the clients you supply people to.',
    howTo: [
      {
        title: 'Set how you use agencies',
        steps: ['Tick We hire through agencies and/or We provide manpower to other companies.', 'Choose Save.'],
      },
      {
        title: 'Add a vendor',
        steps: [
          'Choose Add a vendor and fill the contact.',
          'Tick the Options that apply, such as We hire candidates through them.',
          'Choose Add vendor. It then appears in Hiring through agency on jobs and on profiles.',
        ],
      },
    ],
  },
  {
    id: 'payroll',
    group: 'Pay',
    title: 'Payroll',
    path: '/payroll',
    menu: 'Company › Payroll',
    when: all(has('pay'), payroll),
    why: 'Publish CTC, monthly salary slips and Form 16, then lock the month. Published slips appear on each person\'s My pay.',
    example: 'For April: choose Start draft slips from CTC, check each slip, choose Publish, download the Bank transfer file and choose Lock month.',
    tips: [
      'HRMS does not calculate PF, ESI or tax. Enter deductions on the slip.',
      'Each outlet runs its own payroll. Payroll is available for India outlets.',
      'Lock a month only when every slip is published.',
    ],
    howTo: [
      {
        title: 'Run a payroll month',
        steps: [
          'Pick the month on Payroll month.',
          'Choose Start draft slips from CTC. Each draft uses CTC divided by 12 and the attendance days.',
          'Open a person to check or change the slip.',
          'Choose Publish drafts, then Bank transfer file for the bank upload.',
          'Choose Lock month. Choose Reopen month if something must change.',
        ],
      },
      {
        title: 'Set a person\'s CTC',
        when: has('pay.structure'),
        steps: ['Find the person.', 'Fill CTC breakup and choose Save CTC.', 'Tick Publish for the employee to show it on their My pay.'],
      },
      {
        title: 'Edit a salary slip by hand',
        when: has('pay.slip'),
        steps: ['Find the person and open Salary month.', 'Choose Fill from attendance, adjust the lines and choose Save month.'],
      },
      { title: 'Upload Form 16', when: has('pay.form'), steps: ['Find the person and open Form 16.', 'Choose the PDF and choose Save Form 16.'] },
      { title: 'Design the slip', steps: ['In Slip design tick what each slip shows.', 'Choose Save slip design.'] },
    ],
  },
  {
    id: 'reports',
    group: 'Company',
    title: 'Reports',
    path: '/reports',
    menu: 'Company › Reports',
    when: has('reports'),
    why: 'Run attendance, leave, people, payroll and hiring reports and export them.',
    tips: ['Each report also needs access to its own area. Salary reports need payroll access.', 'Up to 5,000 rows are shown. Narrow the filters for the rest.'],
    howTo: [
      {
        title: 'Run a report',
        steps: [
          'Pick an area chip or search, then open a report.',
          'Set the Month or From and To dates, and filter by department, location or status.',
          'Choose Run report.',
          'Choose Export to Excel (CSV), or Print or save as PDF.',
        ],
      },
      { title: 'What you see', when: (reader) => reader.teamScope, body: 'Reports that follow your team access show Your team only.' },
    ],
  },
  {
    id: 'system-map',
    group: 'Company',
    title: 'System map',
    path: '/system',
    menu: 'Company › System map',
    when: ownerOnly,
    why: 'A live picture of how this HRMS is set up: organisation, who can manage what, the data and the main flows.',
    howTo: [{ title: 'Read the map', steps: ['Use the tabs Overview, Organisation, Access, Data, Flows and API.', 'Choose Print for a paper copy.'] }],
  },
  {
    id: 'settings-general',
    group: 'Setup',
    title: 'Company, salary accounts and brand',
    path: '/settings',
    menu: 'Company › Settings › General',
    when: has('settings'),
    why: 'Company letterhead details, the bank accounts salaries are paid from, and how HRMS looks.',
    howTo: [
      { title: 'Company details', steps: ['Fill Company name, Legal name, address and tax numbers.', 'Choose Save company. Old payslips keep their letterhead.'] },
      {
        title: 'Salary accounts',
        steps: [
          'Choose Add a salary account. IFSC has 11 characters and the account 9 to 18 digits.',
          'Pick which offices it pays, or choose Make default to pay everyone else.',
        ],
      },
      {
        title: 'Brand',
        when: has('settings.brand'),
        steps: ['Set the Brand name, subtitle and website.', 'Upload the App icon and Document logo.', 'Pick a colour preset or Custom colours and choose Save brand.'],
      },
    ],
  },
  {
    id: 'settings-attendance',
    group: 'Setup',
    title: 'Attendance setup',
    path: '/settings',
    menu: 'Settings › More › Attendance',
    when: has('settings'),
    why: 'Where people may check in from, the shift, grace time, overtime and weekly offs.',
    howTo: [
      {
        title: 'Set where people check in',
        steps: [
          'Choose Anywhere in the world, Within one country or At office locations.',
          'For offices, set each point with Use my current location and a radius of 50 to 5,000 metres, then choose Save point.',
          'Tick Only at each person\'s own office if needed, and allow Can check in from anywhere for people who travel.',
          'Choose Approve and save.',
        ],
      },
      { title: 'Set the shift', steps: ['Set shift times, grace and overtime, and the weekly off days.', 'Choose Save attendance.'] },
    ],
  },
  {
    id: 'settings-rules',
    group: 'Setup',
    title: 'Rules, leave types and automation',
    path: '/settings?tab=rules',
    menu: 'Settings › Rules',
    when: has('settings'),
    why: 'Probation, notice period and comp-off rules, leave types, daily automatic jobs, and hiring re-apply gaps. Approval chains are under Approvals.',
    howTo: [
      { title: 'People rules and daily jobs', steps: ['Set probation length, notice period and comp-off.', 'Switch on the daily jobs you want, such as birthday emails.', 'Choose Save people & automation. Choose Run now to try it today.'] },
      { title: 'Hiring re-apply', steps: ['Set the gap after a rejection or after someone leaves.', 'Choose whether the public form shows the cooling message.', 'Choose Save hiring rules.'] },
      { title: 'Leave types', steps: ['Choose a type or New leave type, set the yearly days and rules.', 'Choose Save leave type.'] },
    ],
  },
  {
    id: 'settings-flows',
    group: 'Setup',
    title: 'Approval flows',
    path: '/settings?tab=flows',
    menu: 'Settings › Approvals',
    when: has('settings'),
    why: 'Choose who approves each type of request, in order. For example, work from home goes to the reporting manager and then HR, while extra time goes to the reporting manager and then payroll.',
    howTo: [
      {
        title: 'Set the steps',
        steps: [
          'For each request type, choose who approves step 1: Reporting manager, Manager’s manager, HR, Payroll, or A named person.',
          'Choose Add a step for up to three steps. Choose the cross to remove one.',
          'Choose Save approval flows. New requests follow the new steps. Requests already sent keep their steps.',
        ],
      },
      {
        title: 'How the steps work',
        body: 'Reporting manager falls back to HR when someone has no manager. Manager’s manager is skipped when there is none. HR and Payroll mean everyone with that role in the person’s outlet, and any one of them can decide. A decline at any step ends the request.',
      },
    ],
  },
  {
    id: 'settings-mail',
    group: 'Setup',
    title: 'Email, templates and numbering',
    path: '/settings',
    menu: 'Settings › Email, Templates, Numbering',
    when: has('settings'),
    why: 'The mail accounts HRMS sends from, the wording of each email, and the number formats for codes and slips.',
    howTo: [
      {
        title: 'Add an email account',
        steps: [
          'Open Email and add one or more SMTP accounts (Gmail app password, Outlook, Zoho or custom). Choose Test on each row.',
          'Mark one account as the system default / fallback.',
          'Under Default account by mail type, map Payslips, Leave, Announcements, People lifecycle, Hiring, Celebrations and System mail to the right mailbox, then Save mail routing.',
        ],
      },
      {
        title: 'Edit email templates',
        steps: [
          'Open Templates. Filter by Pay, Time, People, Hiring or System, then pick a purpose.',
          'Use dynamic fields in the subject, heading and message. For the shared header, add a title or tagline and insert company tokens.',
          'Choose a colour combination, customise the footer note, then Save templates. Send test to me to check the look in your inbox.',
        ],
      },
      { title: 'Numbering', steps: ['Open Numbering and set prefixes for employee codes, payslips and requests.', 'Choose Save numbering. Existing codes stay as they are.'] },
      { title: 'Statutory setup', steps: ['Open Statutory and record pay cycle, PF, ESI, PT and TDS details.', 'Choose Save statutory setup. Slips are not yet calculated from these.'] },
    ],
  },
  {
    id: 'settings-integrations',
    group: 'Setup',
    title: 'Integrations and API',
    path: '/settings',
    menu: 'Settings › Integrations',
    when: has('settings'),
    why: 'Connect the AI assistant (bring your own keys), WhatsApp, SMS, biometric readers, salary bank file formats, accounting, team chat and the HRMS API.',
    howTo: [
      {
        title: 'Connect a service',
        steps: ['Choose Configure on the card.', 'Tick Use this connection, pick the Provider and fill its fields.', 'Choose Save and test.'],
      },
      {
        title: 'AI assistant',
        steps: [
          'Open the AI assistant card and choose Configure.',
          'Add an OpenAI, Claude, Gemini, Azure or compatible account with your own key.',
          'Turn on Enable AI assistant. Staff then use the bottom-right chat; answers stay within each person’s access.',
        ],
      },
      { title: 'API key', steps: ['Open API and choose Generate a new key.', 'Copy it now. It is shown once and the old key stops working.'] },
    ],
  },
  {
    id: 'access',
    group: 'Setup',
    title: 'Access and roles',
    path: '/settings',
    menu: 'Settings › More › Access',
    when: has('access'),
    why: 'Decide who may manage each area: by role or by area, then add departments, grades or named people as extras. Everyone always has their own self-service pages.',
    tips: ['Manager and team lead approvals stay on their own reporting line.', 'Changes apply the next time the person loads a page.', 'Typical marks the usual starting set for that role.'],
    howTo: [
      {
        title: 'Give or remove access by role',
        steps: [
          'Open Settings › More › Access.',
          'Stay on By role, pick a role on the left, and switch areas On or Off.',
          'Choose Extras on an area for a department, grade or person.',
          'Choose Save access.',
        ],
      },
      {
        title: 'Review one area across roles',
        steps: [
          'Switch to By area.',
          'Pick the area on the left, then tap role tiles to grant or remove it.',
          'Choose Save access.',
        ],
      },
      { title: 'Download a manual for a role', steps: ['Open User manual from the top right.', 'Pick the role under Manual for a role and choose Download PDF. Hand it to new joiners in that role.'] },
    ],
  },
  {
    id: 'home-layouts',
    group: 'Setup',
    title: 'Home layouts',
    path: '/settings',
    menu: 'Settings › More › Home layouts',
    when: any('settings', 'library'),
    why: 'Choose which Home boxes each audience sees.',
    howTo: [
      {
        title: 'Set a layout',
        steps: [
          'Pick Everyone, A role, A department or A person.',
          'Set each box to Inherit, Show or Hide.',
          'Choose Save layout. A person\'s layout wins over department, then role, then everyone.',
        ],
      },
    ],
  },
  {
    id: 'outlets',
    group: 'Setup',
    title: 'Outlets',
    path: '/settings',
    menu: 'Settings › More › Outlets',
    when: master,
    why: 'Run several branches in one HRMS. Each outlet has its own people and its own payroll.',
    tips: [
      'Each outlet uses one HRMS subscription.',
      'Outlets outside India run HR only, with payroll off.',
      'The last open outlet cannot be archived.',
      'Who can work here links an existing email sign-in to a branch — it does not create a new password.',
      'Masters already see every outlet; they do not need to be added per branch.',
    ],
    howTo: [
      {
        title: 'Add an outlet',
        steps: ['Choose Add outlet and fill the country, state, city, time zone and currency.', 'Choose Copy setup to bring departments, locations, teams, leave types and holidays from another outlet.'],
      },
      {
        title: 'Who can work here',
        steps: [
          'On an outlet choose Who can work here.',
          'Pick an existing sign-in and optionally a role for that branch, then Add.',
          'Under Master access, tick Master for people who may open All outlets and manage this page.',
        ],
      },
      { title: 'Archive', body: 'Choose Archive to close an outlet and Reopen to bring it back.' },
    ],
  },
  {
    id: 'licence',
    group: 'Setup',
    title: 'Licence',
    path: '/settings',
    menu: 'Settings › More › Licence',
    when: has('settings'),
    why: 'Connect this HRMS to your Altamid subscription.',
    howTo: [{ title: 'Enter the licence', steps: ['Paste the License key and Binding host Altamid gave you.', 'Choose Save and check in. The Outlets card shows how many subscriptions you can use.'] }],
  },
];
