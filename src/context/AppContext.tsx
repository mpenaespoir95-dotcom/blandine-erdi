import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  User,
} from 'firebase/auth';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  Contact,
  LedgerEntry,
  PurchaseRecord,
  PurchasePayment,
  SaleRecord,
  SaleBarItem,
  SaleFixingItem,
  SaleAdvancePayment,
  SaleChargeItem,
  GoldStockMovement,
  CurrencyStockMovement,
  Partner,
  Partnership,
  PartnershipCashMovement,
  PartnershipLoan,
  PartnershipRepayment,
  PartnershipStatus,
  GoldCategory,
  PurchaseFormulaConfig,
  DEFAULT_PURCHASE_FORMULA_CONFIG,
  AppRole,
  AppUser,
  AppTask,
  TaskStatus,
  APP_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  APP_MODULES_LIST,
  getModuleServices,
  getDefaultAllowedServices,
  DepositDenominations,
} from '../types';
import {
  calculateFineGoldStockOunces,
  computeAveragePurchaseCostPerFineGramXaf,
  computeSaleProfitBreakdown,
  getUnsoldPurchases,
  goldKaratValue,
  isValidGoldKarat,
  roundOunces,
  TROY_OUNCE_IN_GRAMS,
} from '../utils/goldMath';
import { FirebaseSyncService } from '../services/firebaseSyncService';
import { auth, db } from '../firebase/config';

type AuthStatus = 'loading' | 'signedOut' | 'pending' | 'unverified' | 'active' | 'error';

const isAppRole = (value: unknown): value is AppRole =>
  APP_ROLES.some((role) => role.id === value);

const resolveAuthAccess = async (user: User): Promise<{
  status: AuthStatus;
  role?: AppRole;
  name: string;
  allowedModules?: number[];
  allowedServices?: string[];
  message?: string;
}> => {
  const name = user.displayName || user.email || 'Utilisateur';
  if (!user.emailVerified) return { status: 'unverified', name };

  const profile = await getDoc(doc(db, 'users', user.uid));
  const data = profile.data();
  if (!profile.exists()) {
    const emailLower = (user.email || '').toLowerCase();
    if (emailLower === 'espoirmpena5@gmail.com' || emailLower === 'mpenaespoir95@gmail.com') {
      await setDoc(doc(db, 'users', user.uid), {
        name,
        email: user.email,
        role: 'ADMIN',
        active: true,
      });
      return { status: 'active', role: 'ADMIN', name };
    }
    return { status: 'pending', name };
  }
  if (data?.active !== true || !isAppRole(data.role)) {
    return { status: 'pending', name };
  }

  return {
    status: 'active',
    role: data.role,
    name: typeof data.name === 'string' && data.name.trim() ? data.name : name,
    allowedModules: Array.isArray(data.allowedModules)
      ? data.allowedModules.filter((id): id is number => typeof id === 'number')
      : undefined,
    allowedServices: Array.isArray(data.allowedServices)
      ? data.allowedServices.filter((id): id is string => typeof id === 'string')
      : undefined,
  };
};

const INITIAL_STOCK_MOVEMENTS: GoldStockMovement[] = [
  {
    id: 'mov-init-1',
    label: 'Achat · Moussa Diakité (ACH-2026-0001)',
    karat: '24K',
    weightGrams: 2,
    date: '2026-10-18T10:15:00.000Z',
    type: 'Achat',
    category: 'Or brut',
    reason: 'Stock initial achat ACH-2026-0001',
  },
  {
    id: 'mov-init-2',
    label: 'Achat · Moussa Diakité (ACH-2026-0002)',
    karat: '22K',
    weightGrams: 124.6,
    date: '2026-10-18T14:30:00.000Z',
    type: 'Achat',
    category: 'Or brut',
    reason: 'Stock initial achat ACH-2026-0002',
  },
];

type PurchaseInput = {
  description: string;
  price: number;
  paymentAccount?: string;
  initialPaymentAmount?: number;
  reference?: string;
  supplier?: string;
  grossWeightGrams?: number;
  nonGoldWeightGrams?: number;
  karat?: string;
  goldCategory?: GoldCategory;
  purityPercent?: number;
  referencePricePerGram?: number;
  discountPercent?: number;
  goldPricePerTroyOunceUsd?: number;
  usdToXafRate?: number;
  rateObservedAt?: string;
};

interface AppContextType {
  userName: string;
  isSignedIn: boolean;
  authStatus: AuthStatus;
  authEmail: string;
  authMessage: string;
  contacts: Contact[];
  bankBalances: Record<string, number>;
  operations: LedgerEntry[];
  partnerships: Partnership[];
  partnershipCashMovements: PartnershipCashMovement[];
  partners: Partner[];
  loans: PartnershipLoan[];
  exchanges: string[];
  sales: string[];
  saleRecords: SaleRecord[];
  purchases: PurchaseRecord[];
  stockMovements: GoldStockMovement[];
  currencyBalances: Record<string, number>;
  currencyStockMovements: CurrencyStockMovement[];
  goldCurrencyBalances: Record<string, number>;
  goldCurrencyMovements: CurrencyStockMovement[];
  totalTreasury: number;
  totalProfit: number;
  goldProfit: number;
  currencyProfit: number;
  unprocessedOperations: LedgerEntry[];
  contactsWithAppointments: Contact[];
  purchaseFormulaConfig: PurchaseFormulaConfig;
  
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  register: (details: {
    name: string;
    email: string;
    phone: string;
    requestedRole: AppRole;
    password: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  refreshAuthorization: () => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  editOperation: (operationId: string, updates: Partial<LedgerEntry>) => void;
  depositCash: (params: {
    amount: number;
    depositorName: string;
    reason: string;
    date?: string;
    reference?: string;
    account?: string;
  }) => void;
  withdrawCash: (params: {
    amount: number;
    beneficiaryName: string;
    reason: string;
    date?: string;
    reference?: string;
    account?: string;
  }) => void;
  addContact: (contact: Omit<Contact, 'reference'>) => void;
  updateContact: (contactRef: string, updates: Partial<Omit<Contact, 'reference'>>) => void;
  saveAppointment: (contactRef: string, appointment: string) => void;
  removeAppointment: (contactRef: string) => void;
  markOperationProcessed: (operationId: string) => void;
  addBank: (bankName: string, openingBalance: number) => void;
  deleteBank: (bankName: string) => void;
  addMovement: (bank: string, amount: number, deposit: boolean, label: string) => void;
  transferFunds: (params: { fromAccount: string; toAccount: string; amount: number; label: string }) => void;
  transferToClient: (params: {
    fromAccount: string;
    clientName: string;
    clientBank?: string;
    clientAccountNumber?: string;
    clientBankAgency?: string;
    clientAccountHolder?: string;
    clientBankReference?: string;
    amount: number;
    feeAmount?: number;
    reason?: string;
  }) => LedgerEntry;
  addCashToBankDeposit: (params: {
    targetBank: string;
    amount: number;
    slipNumber?: string;
    depositedBy?: string;
    date?: string;
    note?: string;
    bankGroupName?: string;
    accountNumber?: string;
    accountHolder?: string;
    accountAddress?: string;
    amountInWords?: string;
    depositorAddress?: string;
    depositorPhone?: string;
    depositorEmail?: string;
    orderOf?: string;
    forAccountOf?: string;
    provenanceFonds?: string;
    shiftPeriod?: 'Matin' | 'Soir';
    denominations?: DepositDenominations;
  }) => void;
  addExpense: (params: { account: string; amount: number; description: string; date: string; contactName?: string }) => void;
  addPurchase: (params: PurchaseInput) => void;
  addPurchases: (params: PurchaseInput[]) => PurchaseRecord[];
  updatePurchase: (purchaseId: string, params: PurchaseInput) => void;
  addPurchasePayment: (purchaseId: string, payment: Omit<PurchasePayment, 'paidAt'>) => void;
  cancelPurchase: (purchaseId: string, reason: string) => void;
  stockWeightForKarat: (karat: string, category?: string) => number;
  adjustGoldStock: (params: {
    karat: string;
    category?: string;
    weightGrams: number;
    reason: string;
  }) => void;
  reconcileGoldStockWithUnsoldPurchases: () => number;
  addSale: (params: {
    description: string;
    profit: number;
    revenue?: number;
    revenueUsd?: number;
    weightGrams?: number;
    karat?: string;
    category?: string;
    targetAccount?: string;
  }) => void;
  addSaleRecord: (sale: Omit<SaleRecord, 'id' | 'reference' | 'createdAt'>) => SaleRecord;
  updateSaleRecordBars: (saleId: string, bars: SaleBarItem[]) => SaleRecord;
  updateSaleFixings: (saleId: string, fixings: SaleFixingItem[]) => SaleRecord;
  updateSalePurchaseCost: (saleId: string, purchaseCostXaf?: number) => SaleRecord;
  addSaleAdvance: (
    saleId: string,
    advance: Omit<SaleAdvancePayment, 'id'>,
    clientDetails?: Pick<
      SaleRecord,
      | 'clientName'
      | 'clientReference'
      | 'clientPhone'
      | 'clientCity'
      | 'clientEmail'
      | 'clientBankName'
      | 'clientBankAccountNumber'
    >
  ) => SaleRecord;
  addExchange: (params: {
    description: string;
    receivedCurrency?: string;
    receivedAmount?: number;
    deliveredCurrency?: string;
    deliveredAmount?: number;
  }) => void;
  adjustCurrencyStock: (params: {
    currency: string;
    amount: number;
    isAddition: boolean;
    reason: string;
    movementType?: string;
  }) => void;
  transferGoldCurrencyToPhysical: (params: {
    currency: string;
    amount: number;
    reason?: string;
  }) => void;
  buyCurrency: (params: {
    currency: string;
    amount: number;
    rate: number;
    totalXaf: number;
    paymentAccount?: string;
    contactName?: string;
    notes?: string;
  }) => void;
  sellCurrency: (params: {
    currency: string;
    amount: number;
    rate: number;
    totalXaf: number;
    receiptAccount?: string;
    contactName?: string;
    notes?: string;
  }) => void;
  addPartner: (partner: Omit<Partner, 'id' | 'createdAt'>) => void;
  addPartnership: (partnership: Omit<Partnership, 'id' | 'reference' | 'createdAt'>) => void;
  addPartnershipCashMovement: (
    movement: Omit<PartnershipCashMovement, 'id' | 'createdAt' | 'createdBy'>
  ) => void;
  updatePartnershipStatus: (id: string, status: PartnershipStatus) => void;
  addLoan: (loan: Omit<PartnershipLoan, 'id' | 'reference' | 'createdAt' | 'repayments'>) => void;
  addLoanRepayment: (loanId: string, repayment: Omit<PartnershipRepayment, 'paidAt'>) => void;
  updatePurchaseFormulaConfig: (config: Partial<PurchaseFormulaConfig>) => void;
  resetPurchaseFormulaConfig: () => void;
  resetToDefaults: () => void;

  // Module Utilisateurs, Rôles & Tâches
  users: AppUser[];
  tasks: AppTask[];
  currentRole: AppRole;
  currentUserId: string;
  updateUserPermissions: (userId: string, allowedModules: number[], allowedServices?: string[]) => void;
  canAccessModule: (moduleId: number) => boolean;
  canAccessService: (moduleId: number, serviceId: string) => boolean;
  addUser: (user: Omit<AppUser, 'id' | 'createdAt'>) => void;
  updateUser: (id: string, updates: Partial<AppUser>) => void;
  deleteUser: (id: string) => void;
  addTask: (task: Omit<AppTask, 'id' | 'reference' | 'createdAt' | 'status'>) => void;
  updateTaskStatus: (taskId: string, status: TaskStatus, note?: string) => void;
  deleteTask: (taskId: string) => void;
}

const INITIAL_CONTACTS: Contact[] = [
  {
    reference: 'CLI-00001',
    name: 'Moussa Diakité',
    phone: '+223 76 41 08 92',
    city: 'Bamako',
    roles: ['Fournisseur d’or brut'],
    email: 'moussa.diakite@mali-gold.ml',
    appointment: '20 oct. · 10h30',
  },
  {
    reference: 'CLI-00002',
    name: 'Awa Traoré Bijouterie',
    phone: '+225 07 58 33 14',
    city: 'Abidjan',
    roles: ['Fournisseur de bijoux', 'Client de bijoux'],
    email: 'contact@bijouterie-traore.ci',
    appointment: '19 oct. · 15h00',
  },
  {
    reference: 'CLI-00003',
    name: 'Al Noor Gold Trading',
    phone: '+971 4 226 8814',
    city: 'Dubaï',
    roles: ['Client d’or fondu', 'Client d’or brut'],
    email: 'ops@alnoorgold.ae',
    appointment: '24 oct. · 09h00',
  },
  {
    reference: 'CLI-00004',
    name: 'Jean-Paul Mbarga',
    phone: '+237 6 77 21 45 09',
    city: 'Douala',
    roles: ['Client de devises (Change)'],
    email: 'jp.mbarga@express-finance.cm',
  },
  {
    reference: 'CLI-00005',
    name: 'Li Wei Import-Export',
    phone: '+86 20 8371 5562',
    city: 'Guangzhou',
    roles: ['Fournisseur de devises (Change)', 'Client de devises (Change)'],
    email: 'liwei@cantongoldtraders.cn',
  },
  {
    reference: 'CLI-00006',
    name: 'Seydou Coulibaly',
    phone: '+226 70 12 88 31',
    city: 'Ouagadougou',
    roles: ['Fournisseur d’or fondu'],
    email: 'coulibaly.seydou@burkina-or.bf',
  },
  {
    reference: 'CLI-00007',
    name: 'Mr. DIEFAGA-2',
    phone: '+971 50 892 4110',
    city: 'Dubaï',
    roles: ['Client d’or fondu', 'Client d’or brut'],
    email: 'diefaga.gold@dubaitrade.ae',
    bankName: 'Emirates NBD',
    bankAccountNumber: 'AE290260001009823451',
  },
];

const INITIAL_BANK_BALANCES: Record<string, number> = {
  'Ecobank': 38412750,
  'UBA': 21908400,
  'Orabank': 9645100,
  'Caisse (espèces)': 6284500,
};

const INITIAL_OPERATIONS: LedgerEntry[] = [
  {
    id: 'op-1',
    title: 'Achat 2 g · 24K',
    subtitle: 'Moussa Diakité',
    amount: 89000,
    date: '18 oct. 2026',
    isIncome: false,
    isProcessed: false,
  },
  {
    id: 'op-2',
    title: 'Échange CNY · Chine',
    subtitle: 'Li Wei Import-Export',
    amount: 4156450,
    date: '18 oct. 2026',
    isIncome: true,
    isProcessed: true,
  },
  {
    id: 'op-3',
    title: 'Achat 38,2 g · 18K',
    subtitle: 'Awa Traoré Bijouterie',
    amount: 1235000,
    date: '17 oct. 2026',
    isIncome: false,
    isProcessed: true,
  },
];

const INITIAL_PURCHASES: PurchaseRecord[] = [
  {
    id: 'purch-1',
    reference: 'ACH-2026-0001',
    description: '18 oct. · Moussa Diakité · 2 g · 24K · 89 000 FCFA',
    amount: 89000,
    purchasedAt: '2026-10-18T10:15:00.000Z',
    supplier: 'Moussa Diakité',
    grossWeightGrams: 2,
    nonGoldWeightGrams: 0,
    netWeightGrams: 2,
    karat: '24K',
    goldCategory: 'Or brut',
    purityPercent: 100,
    referencePricePerGram: 44500,
    payments: [
      {
        amount: 89000,
        paidAt: '2026-10-18T10:15:00.000Z',
        method: 'Paiement immédiat',
        account: 'Caisse (espèces)',
      },
    ],
  },
  {
    id: 'purch-2',
    reference: 'ACH-2026-0002',
    description: '18 oct. · Moussa Diakité · 124,6 g · 22K · 4 700 000 FCFA',
    amount: 4700000,
    purchasedAt: '2026-10-18T14:30:00.000Z',
    supplier: 'Moussa Diakité',
    grossWeightGrams: 124.6,
    nonGoldWeightGrams: 0,
    netWeightGrams: 124.6,
    karat: '22K',
    goldCategory: 'Or brut',
    purityPercent: (22 / 24) * 100,
    referencePricePerGram: 37720,
    payments: [
      {
        amount: 4700000,
        paidAt: '2026-10-18T14:30:00.000Z',
        method: 'Paiement immédiat',
        account: 'Ecobank',
      },
    ],
  },
];

const INITIAL_CURRENCY_BALANCES: Record<string, number> = {
  USD: 14500,
  EUR: 8200,
  XAF: 4500000,
  XOF: 3200000,
  AED: 26800,
  CNY: 48500,
};

const INITIAL_EXCHANGES = [
  '48 500 CNY · Chine · Li Wei Import-Export',
  '6 250 000 XAF · Cameroun · Jean-Paul Mbarga',
  '73 200 AED · Dubaï · Al Noor Gold Trading',
];

const INITIAL_SALES = [
  'Al Noor Gold Trading · 512,3 g · bénéfice 2 371 698 FCFA',
];

const INITIAL_SALE_RECORDS: SaleRecord[] = [
  {
    id: 'sale-rec-1',
    reference: 'VTE-2026-0001',
    clientName: 'Mr. DIEFAGA-2',
    date: '20/10/2026',
    createdAt: '2026-10-20T10:00:00.000Z',
    bars: [
      {
        id: 'bar-1',
        srNo: '001',
        barRef: 'P4015',
        barWeight: 426.0,
        sampleWeight: 2.82,
        goldPurity: 0.707,
        carat: 16.97,
        pureWeightGrams: 303.176,
        ounces: 9.75,
      },
    ],
    totalGeneralWeightGrams: 426.0,
    totalSampleWeightGrams: 2.82,
    averagePurity: 0.707,
    averageCarat: 16.97,
    totalPureWeight24kGrams: 303.176,
    totalPureOunces: 9.75,
    fixingDate: '20/10/2026',
    fixingPricePerOunceUsd: 4051.0,
    grossRevenueUsd: 39486.39,
    grossRevenueAed: 144915.05,
    grossRevenueXaf: 23968238,
    charges: [
      {
        id: 'ch-1',
        date: '20/10/2026',
        type: 'discount',
        label: 'DISCOUNT',
        rateOrDetails: '$ 11.50/oz',
        amountUsd: 112.09,
        amountAed: 411.39,
      },
      {
        id: 'ch-2',
        date: '20/10/2026',
        type: 'testing',
        label: 'TESTING',
        rateOrDetails: 'Spectrométrie & Essai',
        amountUsd: 13.62,
        amountAed: 50.0,
      },
      {
        id: 'ch-3',
        date: '20/10/2026',
        type: 'melting',
        label: 'MELTING',
        rateOrDetails: 'Frais de fonte',
        amountUsd: 4.09,
        amountAed: 15.0,
      },
      {
        id: 'ch-4',
        date: '20/10/2026',
        type: 'customs',
        label: 'CUSTOMS',
        rateOrDetails: 'Douane & Export',
        amountUsd: 13.62,
        amountAed: 50.0,
      },
      {
        id: 'ch-5',
        date: '28/10/2026',
        type: 'swap',
        label: 'SWAP',
        rateOrDetails: 'Frais de swap',
        amountUsd: 54.58,
        amountAed: 200.33,
      },
    ],
    totalChargesUsd: 198.0,
    advances: [
      {
        id: 'adv-1',
        date: '20/10/2026',
        label: 'TRANSFER FROM LOT 1 (Acompte)',
        amountUsd: 35422.34,
        amountAed: 130000.0,
        amountXaf: 21501360,
        account: 'Caisse (espèces)',
        note: 'Acompte principal reçu au règlement',
      },
    ],
    totalAdvancesUsd: 35422.34,
    totalWithdrawUsd: 35620.36,
    totalWithdrawAed: 130726.71,
    balanceRemainingUsd: 3866.03,
    balanceRemainingAed: 14188.34,
    balanceRemainingXaf: 2346678,
    usdToAedRate: 3.67,
    usdToXafRate: 606.85,
    status: 'partially_paid',
    targetAccount: 'Caisse (espèces)',
    notes: 'Bordereau export Dubaï - Lot P4015',
  },
];

const INITIAL_PARTNERS: Partner[] = [
  {
    id: 'part-1',
    name: 'El Hadj Ousmane Sow',
    createdAt: '2026-09-01T08:00:00.000Z',
    phone: '+223 66 50 11 22',
    city: 'Bamako',
    email: 'ousmane.sow@invest-sahel.com',
    isActive: true,
    type: 'Investisseur',
  },
  {
    id: 'part-2',
    name: 'Fonderie Moderne de Bamako',
    createdAt: '2026-09-10T09:00:00.000Z',
    phone: '+223 75 12 99 00',
    city: 'Bamako',
    email: 'fonderie.bamako@africagold.com',
    isActive: true,
    type: 'Transformateur',
  },
  {
    id: 'part-3',
    name: 'Société Aurifère du Sahel (SAS)',
    createdAt: '2026-10-02T11:00:00.000Z',
    phone: '+221 33 824 55 10',
    city: 'Dakar',
    email: 'direction@sahel-aurifere.sn',
    isActive: true,
    type: 'Partenaire financier',
  },
];

const INITIAL_PARTNERSHIPS: Partnership[] = [
  {
    id: 'ptn-1',
    reference: 'PAR-2026-0001',
    scenario: 'financialPurchase',
    status: 'transactionInProgress',
    remunerationMethod: 'contractualProfitShares',
    remunerationValue: 40,
    note: 'Co-financement de la campagne d’achat de la mine artisanale de Yanfolila.',
    createdAt: '2026-10-10T10:00:00.000Z',
    members: [
      {
        id: 'mem-1',
        partnerId: 'part-1',
        name: 'El Hadj Ousmane Sow',
        role: 'Co-investisseur (40%)',
        phone: '+223 66 50 11 22',
        profitSharePercent: 40,
        contributions: [
          {
            id: 'c-1',
            kind: 'financial',
            isValidated: true,
            amountXaf: 15000000,
            purityIsProvisional: false,
          },
        ],
      },
      {
        id: 'mem-2',
        name: 'Cams Gold (Comptoir)',
        role: 'Opérateur principal (60%)',
        isCompany: true,
        profitSharePercent: 60,
        contributions: [
          {
            id: 'c-2',
            kind: 'financial',
            isValidated: true,
            amountXaf: 22500000,
            purityIsProvisional: false,
          },
        ],
      },
    ],
  },
  {
    id: 'ptn-2',
    reference: 'PAR-2026-0002',
    scenario: 'meltingAndTransformation',
    status: 'analysis',
    remunerationMethod: 'fixedCommission',
    remunerationValue: 250000,
    note: 'Fonte et affinage de 4 lingots bruts vers 24K avant expédition Dubaï.',
    createdAt: '2026-10-15T15:00:00.000Z',
    analysisBefore: {
      netWeightGrams: 840.5,
      purityPercent: 89.2,
      isProvisional: false,
      analyzedAt: '2026-10-15T16:00:00.000Z',
    },
    analysisAfter: {
      netWeightGrams: 832.1,
      purityPercent: 91.8,
      isProvisional: false,
      analyzedAt: '2026-10-16T11:00:00.000Z',
    },
    members: [
      {
        id: 'mem-3',
        partnerId: 'part-2',
        name: 'Fonderie Moderne de Bamako',
        role: 'Fondeur agréé',
        phone: '+223 75 12 99 00',
        contributions: [
          {
            id: 'c-3',
            kind: 'service',
            isValidated: true,
            serviceDescription: 'Fonte haute température, analyse spectromètre XRF et coupellation.',
            purityIsProvisional: false,
          },
        ],
      },
    ],
  },
];

const INITIAL_LOANS: PartnershipLoan[] = [
  {
    id: 'loan-1',
    reference: 'PRET-2026-0001',
    partnerName: 'El Hadj Ousmane Sow',
    partnerId: 'part-1',
    direction: 'companyBorrows',
    principalXaf: 10000000,
    dueAt: '2026-11-30T00:00:00.000Z',
    note: 'Avance de trésorerie pour grosse commande de lingotins.',
    createdAt: '2026-10-05T09:00:00.000Z',
    createdBy: 'Aminata',
    repayments: [
      {
        id: 'rep-1',
        amountXaf: 4000000,
        paidAt: '2026-10-20T14:00:00.000Z',
        note: 'Premier remboursement partiel après vente locale.',
        createdBy: 'Aminata',
      },
    ],
  },
];

export const INITIAL_USERS: AppUser[] = [
  {
    id: 'usr-1',
    name: 'Mamadou Keita',
    email: 'm.keita@camsgold.com',
    phone: '+223 76 12 34 56',
    role: 'ADMIN',
    roleLabel: 'Administrateur / Gérant',
    status: 'active',
    avatarBg: '#D39725',
    createdAt: '01/01/2026',
    allowedModules: DEFAULT_ROLE_PERMISSIONS.ADMIN,
  },
  {
    id: 'usr-2',
    name: 'Fatoumata Bamba',
    email: 'f.bamba@camsgold.com',
    phone: '+223 65 98 76 54',
    role: 'CASHIER',
    roleLabel: 'Caissière Principale',
    status: 'active',
    avatarBg: '#008B62',
    createdAt: '15/01/2026',
    allowedModules: DEFAULT_ROLE_PERMISSIONS.CASHIER,
  },
  {
    id: 'usr-3',
    name: 'Ibrahim Diarra',
    email: 'i.diarra@camsgold.com',
    phone: '+223 70 11 22 33',
    role: 'BUYER',
    roleLabel: 'Acheteur & Peseur Or',
    status: 'active',
    avatarBg: '#D97706',
    createdAt: '10/02/2026',
    allowedModules: DEFAULT_ROLE_PERMISSIONS.BUYER,
  },
  {
    id: 'usr-4',
    name: 'Amadou Touré',
    email: 'a.toure@camsgold.com',
    phone: '+971 50 123 4567',
    role: 'SALES',
    roleLabel: 'Responsable Export & Dubaï',
    status: 'active',
    avatarBg: '#204B57',
    createdAt: '05/02/2026',
    allowedModules: DEFAULT_ROLE_PERMISSIONS.SALES,
  },
  {
    id: 'usr-5',
    name: 'Salif Coulibaly',
    email: 's.coulibaly@camsgold.com',
    phone: '+223 79 44 55 66',
    role: 'AUDITOR',
    roleLabel: 'Auditeur & Contrôleur de Gestion',
    status: 'active',
    avatarBg: '#6366F1',
    createdAt: '20/02/2026',
    allowedModules: DEFAULT_ROLE_PERMISSIONS.AUDITOR,
  },
];

export const INITIAL_TASKS: AppTask[] = [
  {
    id: 'tsk-001',
    reference: 'TSK-2026-001',
    title: 'Pesée & contrôle de densité du lot d’or brut P4015',
    description: 'Vérifier le poids brut général (426.000g), prélever l’échantillon (2.820g) et tester le titre au spectromètre avant expédition Dubaï.',
    assignedRole: 'BUYER',
    assignedUserId: 'usr-3',
    assignedUserName: 'Ibrahim Diarra',
    category: 'Achats & Fonderie',
    priority: 'urgent',
    status: 'in_progress',
    dueDate: 'Aujourd’hui',
    createdAt: '20/10/2026',
    createdBy: 'Mamadou Keita (Admin)',
  },
  {
    id: 'tsk-002',
    reference: 'TSK-2026-002',
    title: 'Encaisser le solde restant ($3,866.03) de Mr. DIEFAGA',
    description: 'Vérifier la réception du complément sur le compte Dubaï / Caisse pour solder le bordereau EXP-2026-001.',
    assignedRole: 'SALES',
    assignedUserId: 'usr-4',
    assignedUserName: 'Amadou Touré',
    category: 'Ventes Dubaï',
    priority: 'high',
    status: 'todo',
    dueDate: '25/10/2026',
    createdAt: '20/10/2026',
    createdBy: 'Mamadou Keita (Admin)',
  },
  {
    id: 'tsk-003',
    reference: 'TSK-2026-003',
    title: 'Versement de 10 000 000 FCFA de la caisse espèces vers Ecobank',
    description: 'Préparer le bordereau de versement espèces, faire le dépôt en agence et saisir la quittance dans le module Banques.',
    assignedRole: 'CASHIER',
    assignedUserId: 'usr-2',
    assignedUserName: 'Fatoumata Bamba',
    category: 'Caisse & Trésorerie',
    priority: 'high',
    status: 'todo',
    dueDate: 'Aujourd’hui 15h00',
    createdAt: '20/10/2026',
    createdBy: 'Mamadou Keita (Admin)',
  },
  {
    id: 'tsk-004',
    reference: 'TSK-2026-004',
    title: 'Inventaire physique hebdomadaire des stocks d’or (Brut, Fondu, Bijoux)',
    description: 'Réconciliation des pesées physiques en coffre-fort avec le registre numérique du stock or.',
    assignedRole: 'AUDITOR',
    assignedUserId: 'usr-5',
    assignedUserName: 'Salif Coulibaly',
    category: 'Audit & Contrôle',
    priority: 'normal',
    status: 'todo',
    dueDate: 'Vendredi 17h00',
    createdAt: '21/10/2026',
    createdBy: 'Mamadou Keita (Admin)',
  },
  {
    id: 'tsk-005',
    reference: 'TSK-2026-005',
    title: 'Actualisation des cours devises et pointage stock USD / AED',
    description: 'Vérifier les devises physiques en caisse et mettre à jour le cours officiel et taux marché noir.',
    assignedRole: 'CASHIER',
    assignedUserId: 'usr-2',
    assignedUserName: 'Fatoumata Bamba',
    category: 'Stock Or & Devises',
    priority: 'normal',
    status: 'completed',
    dueDate: 'Aujourd’hui',
    createdAt: '19/10/2026',
    createdBy: 'Mamadou Keita (Admin)',
    completedAt: '20/10/2026',
    completedBy: 'Fatoumata Bamba',
    completionNote: 'Stock USD 100% vérifié, 15,000 USD en coffre.',
  },
];

const AppContext = createContext<AppContextType | undefined>(undefined);

const loadRecordsWithoutSeedData = <T,>(
  storageKey: string,
  seedRecords: readonly T[],
  getRecordId: (record: T) => string
): T[] => {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return [];

  try {
    const records = JSON.parse(saved) as T[];
    if (!Array.isArray(records)) return [];
    const seedIds = new Set(seedRecords.map(getRecordId));
    return records.filter((record) => !seedIds.has(getRecordId(record)));
  } catch {
    return [];
  }
};

const EMPTY_BANK_BALANCES = { 'Caisse (espèces)': 0 };
const EMPTY_CURRENCY_BALANCES = { USD: 0, EUR: 0, XAF: 0, XOF: 0, AED: 0, CNY: 0 };
const EMPTY_GOLD_CURRENCY_BALANCES: Record<string, number> = { USD: 0 };

const getLegacyGoldMovementsFromStorage = (): CurrencyStockMovement[] => {
  if (localStorage.getItem('cg_goldCurrencyBalances') !== null) return [];
  try {
    const saved = localStorage.getItem('cg_currencyStockMovements');
    if (!saved) return [];
    const parsed = JSON.parse(saved) as CurrencyStockMovement[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m) => m.type === 'Encaissement vente or');
  } catch {
    return [];
  }
};

const clearReportedDemoTreasury = (balances: Record<string, number>) => {
  const total = Object.values(balances).reduce((sum, amount) => sum + amount, 0);
  if (balances['Caisse (espèces)'] !== 456706 || total !== 88825886) return balances;

  return Object.fromEntries(
    [...new Set([...Object.keys(balances), 'Caisse (espèces)'])].map((account) => [account, 0])
  );
};

const removeLegacyMarketRates = (config: Partial<PurchaseFormulaConfig>): Partial<PurchaseFormulaConfig> => ({
  ...config,
  officialUsdRate: config.officialUsdRate === 606.85 ? 0 : config.officialUsdRate,
  blackMarketUsdRate: config.blackMarketUsdRate === 640 ? 0 : config.blackMarketUsdRate,
  kitcoGoldSpotUsd: config.kitcoGoldSpotUsd === 2748.5 ? undefined : config.kitcoGoldSpotUsd,
});

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [userName, setUserName] = useState('');
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading');
  const [authEmail, setAuthEmail] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const isSignedIn = authStatus === 'active';
  const registrationInProgress = useRef(false);
  const [contacts, setContacts] = useState<Contact[]>(() => {
    return loadRecordsWithoutSeedData('cg_contacts', INITIAL_CONTACTS, (contact) => contact.reference);
  });
  const [bankBalances, setBankBalances] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem('cg_bankBalances');
    if (!saved) return EMPTY_BANK_BALANCES;
    try {
      const balances = JSON.parse(saved) as Record<string, number>;
      if (JSON.stringify(balances) === JSON.stringify(INITIAL_BANK_BALANCES)) return EMPTY_BANK_BALANCES;
      return clearReportedDemoTreasury(balances);
    } catch {
      return EMPTY_BANK_BALANCES;
    }
  });
  const [operations, setOperations] = useState<LedgerEntry[]>(() => {
    return loadRecordsWithoutSeedData('cg_operations', INITIAL_OPERATIONS, (operation) => operation.id);
  });
  const [purchases, setPurchases] = useState<PurchaseRecord[]>(() => {
    return loadRecordsWithoutSeedData('cg_purchases', INITIAL_PURCHASES, (purchase) => purchase.id);
  });
  const [stockMovements, setStockMovements] = useState<GoldStockMovement[]>(() => {
    return loadRecordsWithoutSeedData('cg_stockMovements', INITIAL_STOCK_MOVEMENTS, (movement) => movement.id);
  });
  const [currencyBalances, setCurrencyBalances] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem('cg_currencyBalances');
    if (!saved) return EMPTY_CURRENCY_BALANCES;
    try {
      const balances = JSON.parse(saved) as Record<string, number>;
      if (JSON.stringify(balances) === JSON.stringify(INITIAL_CURRENCY_BALANCES)) {
        return EMPTY_CURRENCY_BALANCES;
      }
      const migrated = getLegacyGoldMovementsFromStorage();
      if (migrated.length === 0) return balances;
      const adjusted = { ...balances };
      for (const mov of migrated) {
        if (mov.amount > 0) {
          adjusted[mov.currency] = Math.max(0, (adjusted[mov.currency] ?? 0) - mov.amount);
        }
      }
      return adjusted;
    } catch {
      return EMPTY_CURRENCY_BALANCES;
    }
  });
  const [currencyStockMovements, setCurrencyStockMovements] = useState<CurrencyStockMovement[]>(() => {
    const saved = localStorage.getItem('cg_currencyStockMovements');
    if (!saved) return [];
    try {
      const parsed = JSON.parse(saved) as CurrencyStockMovement[];
      if (!Array.isArray(parsed)) return [];
      const shouldMigrate = localStorage.getItem('cg_goldCurrencyBalances') === null;
      return shouldMigrate
        ? parsed.filter((m) => m.type !== 'Encaissement vente or')
        : parsed;
    } catch {
      return [];
    }
  });
  const [goldCurrencyBalances, setGoldCurrencyBalances] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem('cg_goldCurrencyBalances');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Record<string, number>;
        const filtered = Object.fromEntries(
          Object.entries(parsed).filter(([cur, bal]) => cur === 'USD' || (typeof bal === 'number' && bal > 0))
        );
        return { ...EMPTY_GOLD_CURRENCY_BALANCES, ...filtered };
      } catch {
        return EMPTY_GOLD_CURRENCY_BALANCES;
      }
    }
    const migrated = getLegacyGoldMovementsFromStorage();
    const initial: Record<string, number> = { ...EMPTY_GOLD_CURRENCY_BALANCES };
    for (const mov of migrated) {
      initial[mov.currency] = (initial[mov.currency] ?? 0) + mov.amount;
    }
    return initial;
  });
  const [goldCurrencyMovements, setGoldCurrencyMovements] = useState<CurrencyStockMovement[]>(() => {
    const saved = localStorage.getItem('cg_goldCurrencyMovements');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as CurrencyStockMovement[];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return getLegacyGoldMovementsFromStorage();
  });
  const [exchanges, setExchanges] = useState<string[]>(() => {
    return loadRecordsWithoutSeedData('cg_exchanges', INITIAL_EXCHANGES, (exchange) => exchange);
  });
  const [sales, setSales] = useState<string[]>(() => {
    return loadRecordsWithoutSeedData('cg_sales', INITIAL_SALES, (sale) => sale);
  });
  const [saleRecords, setSaleRecords] = useState<SaleRecord[]>(() => {
    return loadRecordsWithoutSeedData('cg_saleRecords', INITIAL_SALE_RECORDS, (sale) => sale.id);
  });
  const [partners, setPartners] = useState<Partner[]>(() => {
    return loadRecordsWithoutSeedData('cg_partners', INITIAL_PARTNERS, (partner) => partner.id);
  });
  const [partnerships, setPartnerships] = useState<Partnership[]>(() => {
    return loadRecordsWithoutSeedData('cg_partnerships', INITIAL_PARTNERSHIPS, (partnership) => partnership.id);
  });
  const [partnershipCashMovements, setPartnershipCashMovements] = useState<PartnershipCashMovement[]>(() => {
    const saved = localStorage.getItem('cg_partnership_cash_movements');
    if (!saved) return [];
    try {
      const movements = JSON.parse(saved) as PartnershipCashMovement[];
      return Array.isArray(movements) ? movements : [];
    } catch {
      return [];
    }
  });
  const [loans, setLoans] = useState<PartnershipLoan[]>(() => {
    return loadRecordsWithoutSeedData('cg_loans', INITIAL_LOANS, (loan) => loan.id);
  });
  const [purchaseFormulaConfig, setPurchaseFormulaConfig] = useState<PurchaseFormulaConfig>(() => {
    const saved = localStorage.getItem('cg_purchase_formula_config');
    if (saved) {
      try {
        const savedConfig = JSON.parse(saved) as Partial<PurchaseFormulaConfig>;
        return {
          ...DEFAULT_PURCHASE_FORMULA_CONFIG,
          ...removeLegacyMarketRates(savedConfig),
          useParallelRateInPurchases: true,
        };
      } catch {
        return DEFAULT_PURCHASE_FORMULA_CONFIG;
      }
    }
    return DEFAULT_PURCHASE_FORMULA_CONFIG;
  });

  const [users, setUsers] = useState<AppUser[]>(() => {
    return loadRecordsWithoutSeedData('cg_users', INITIAL_USERS, (user) => user.id);
  });

  const [tasks, setTasks] = useState<AppTask[]>(() => {
    return loadRecordsWithoutSeedData('cg_tasks', INITIAL_TASKS, (task) => task.id);
  });

  const [currentRole, setCurrentRoleState] = useState<AppRole>('CASHIER');
  const [currentUserId, setCurrentUserIdState] = useState('');
  const [profileAllowedModules, setProfileAllowedModules] = useState<number[] | undefined>(undefined);
  const [profileAllowedServices, setProfileAllowedServices] = useState<string[] | undefined>(undefined);

  useEffect(() => {
    localStorage.removeItem('cg_isSignedIn');
    localStorage.removeItem('cg_currentRole');
    localStorage.removeItem('cg_currentUserId');
    let activeCheck = 0;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (registrationInProgress.current) return;
      const checkId = ++activeCheck;
      if (!user) {
        setAuthStatus('signedOut');
        setAuthEmail('');
        setAuthMessage('');
        setUserName('');
        setCurrentUserIdState('');
        setCurrentRoleState('CASHIER');
        setProfileAllowedModules(undefined);
        setProfileAllowedServices(undefined);
        return;
      }

      setAuthEmail(user.email || '');
      setAuthMessage('');
      void resolveAuthAccess(user)
        .then((access) => {
          if (checkId !== activeCheck) return;
          setAuthStatus(access.status);
          setUserName(access.name);
          if (access.role) setCurrentRoleState(access.role);
          setCurrentUserIdState(user.uid);
          setProfileAllowedModules(access.allowedModules);
          setProfileAllowedServices(access.allowedServices);

          if (access.status === 'active' && access.role) {
            const roleMeta = APP_ROLES.find((r) => r.id === access.role);
            const fallbackModules = access.allowedModules ?? DEFAULT_ROLE_PERMISSIONS[access.role] ?? [0];
            const fallbackServices = access.allowedServices ?? getDefaultAllowedServices(fallbackModules);
            setUsers((prev) => {
              const existingIndex = prev.findIndex(
                (u) =>
                  u.id === user.uid ||
                  (user.email && u.email.toLowerCase() === user.email.toLowerCase())
              );
              if (existingIndex >= 0) {
                const existing = prev[existingIndex];
                const updated: AppUser = {
                  ...existing,
                  id: user.uid,
                  name: access.name || existing.name,
                  email: user.email || existing.email,
                  role: access.role!,
                  roleLabel: roleMeta?.label || existing.roleLabel,
                  allowedModules: access.allowedModules ?? existing.allowedModules ?? fallbackModules,
                  allowedServices: access.allowedServices ?? existing.allowedServices ?? fallbackServices,
                };
                return prev.map((u, idx) => (idx === existingIndex ? updated : u));
              }
              return [
                {
                  id: user.uid,
                  name: access.name,
                  email: user.email || '',
                  role: access.role!,
                  roleLabel: roleMeta?.label || access.role!,
                  status: 'active',
                  avatarBg: roleMeta?.color || '#D39725',
                  createdAt: new Date().toLocaleDateString('fr-FR'),
                  allowedModules: fallbackModules,
                  allowedServices: fallbackServices,
                },
                ...prev,
              ];
            });
          }
        })
        .catch((error: unknown) => {
          if (checkId !== activeCheck) return;
          console.error('Firebase authorization check failed:', error);
          setAuthStatus('error');
          setAuthMessage('Impossible de vérifier vos droits. Vérifiez votre connexion puis réessayez.');
        });
    });

    return () => {
      activeCheck += 1;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isSignedIn || currentRole !== 'ADMIN') return;
    let cancelled = false;
    void getDocs(collection(db, 'users'))
      .then((snap) => {
        if (cancelled || snap.empty) return;
        const remoteUsers: AppUser[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data();
          if (!isAppRole(data.role)) return;
          const roleMeta = APP_ROLES.find((r) => r.id === data.role);
          const modules = Array.isArray(data.allowedModules)
            ? data.allowedModules.filter((id: unknown): id is number => typeof id === 'number')
            : DEFAULT_ROLE_PERMISSIONS[data.role] || [0];
          const services = Array.isArray(data.allowedServices)
            ? data.allowedServices.filter((id: unknown): id is string => typeof id === 'string')
            : getDefaultAllowedServices(modules);
          remoteUsers.push({
            id: docSnap.id,
            name: typeof data.name === 'string' && data.name.trim() ? data.name : (data.email || 'Utilisateur'),
            email: typeof data.email === 'string' ? data.email : '',
            phone: typeof data.phone === 'string' ? data.phone : undefined,
            role: data.role,
            roleLabel: roleMeta?.label || data.role,
            status: data.active === false ? 'suspended' : 'active',
            avatarBg: roleMeta?.color || '#D39725',
            createdAt: new Date().toLocaleDateString('fr-FR'),
            allowedModules: modules,
            allowedServices: services,
          });
        });
        if (remoteUsers.length === 0) return;
        setUsers((prev) => {
          const merged = new Map<string, AppUser>();
          for (const localUser of prev) {
            merged.set(localUser.email ? localUser.email.toLowerCase() : localUser.id, localUser);
          }
          for (const remoteUser of remoteUsers) {
            const key = remoteUser.email ? remoteUser.email.toLowerCase() : remoteUser.id;
            const localExisting = merged.get(key);
            merged.set(key, {
              ...(localExisting || {}),
              ...remoteUser,
              allowedModules: remoteUser.allowedModules,
              allowedServices: remoteUser.allowedServices,
            });
          }
          return Array.from(merged.values());
        });
      })
      .catch((err) => {
        console.warn('Could not fetch Firestore users list:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, currentRole]);

  // Sync to local storage
  useEffect(() => {
    localStorage.setItem('cg_userName', userName);
    localStorage.setItem('cg_contacts', JSON.stringify(contacts));
    localStorage.setItem('cg_bankBalances', JSON.stringify(bankBalances));
    localStorage.setItem('cg_operations', JSON.stringify(operations));
    localStorage.setItem('cg_purchases', JSON.stringify(purchases));
    localStorage.setItem('cg_stockMovements', JSON.stringify(stockMovements));
    localStorage.setItem('cg_currencyBalances', JSON.stringify(currencyBalances));
    localStorage.setItem('cg_currencyStockMovements', JSON.stringify(currencyStockMovements));
    localStorage.setItem('cg_goldCurrencyBalances', JSON.stringify(goldCurrencyBalances));
    localStorage.setItem('cg_goldCurrencyMovements', JSON.stringify(goldCurrencyMovements));
    localStorage.setItem('cg_exchanges', JSON.stringify(exchanges));
    localStorage.setItem('cg_sales', JSON.stringify(sales));
    localStorage.setItem('cg_saleRecords', JSON.stringify(saleRecords));
    localStorage.setItem('cg_partners', JSON.stringify(partners));
    localStorage.setItem('cg_partnerships', JSON.stringify(partnerships));
    localStorage.setItem('cg_partnership_cash_movements', JSON.stringify(partnershipCashMovements));
    localStorage.setItem('cg_loans', JSON.stringify(loans));
    localStorage.setItem('cg_purchase_formula_config', JSON.stringify(purchaseFormulaConfig));
    localStorage.setItem('cg_users', JSON.stringify(users));
    localStorage.setItem('cg_tasks', JSON.stringify(tasks));
  }, [
    userName,
    contacts,
    bankBalances,
    operations,
    purchases,
    stockMovements,
    currencyBalances,
    currencyStockMovements,
    goldCurrencyBalances,
    goldCurrencyMovements,
    exchanges,
    sales,
    saleRecords,
    partners,
    partnerships,
    partnershipCashMovements,
    loans,
    purchaseFormulaConfig,
    users,
    tasks,
  ]);

  const hasSyncedPurchasesRef = useRef(false);
  const hasSyncedStockRef = useRef(false);
  const hasSyncedSalesRef = useRef(false);
  const hasAutoReconciledSoldStockRef = useRef(false);

  // Real-time synchronization with Firebase Firestore
  useEffect(() => {
    if (!isSignedIn) {
      hasSyncedPurchasesRef.current = false;
      hasSyncedStockRef.current = false;
      hasSyncedSalesRef.current = false;
      hasAutoReconciledSoldStockRef.current = false;
      return;
    }

    const unsubPurchases = FirebaseSyncService.subscribeToPurchases((remotePurchases) => {
      hasSyncedPurchasesRef.current = true;
      if (remotePurchases && remotePurchases.length > 0) {
        const cleanedPurchases = remotePurchases.filter(
          (purchase) => !INITIAL_PURCHASES.some((seed) => seed.id === purchase.id)
        );
        if (cleanedPurchases.length > 0) setPurchases(cleanedPurchases);
      }
    });

    const unsubStock = FirebaseSyncService.subscribeToStockMovements((remoteMovements) => {
      hasSyncedStockRef.current = true;
      if (remoteMovements && remoteMovements.length > 0) {
        const cleanedMovements = remoteMovements.filter(
          (movement) => !INITIAL_STOCK_MOVEMENTS.some((seed) => seed.id === movement.id)
        );
        if (cleanedMovements.length > 0) setStockMovements(cleanedMovements);
      }
    });

    const unsubAccounts = FirebaseSyncService.subscribeToAccounts((remoteBalances) => {
      if (remoteBalances && Object.keys(remoteBalances).length > 0) {
        const keys = Object.keys(remoteBalances).sort();
        const seedKeys = Object.keys(INITIAL_BANK_BALANCES).sort();
        const isSeedBalance =
          keys.length === seedKeys.length &&
          keys.every((key, index) => key === seedKeys[index] && remoteBalances[key] === INITIAL_BANK_BALANCES[key]);
        const cleanedBalances = isSeedBalance
          ? EMPTY_BANK_BALANCES
          : clearReportedDemoTreasury(remoteBalances);
        setBankBalances(cleanedBalances);
        if (cleanedBalances !== remoteBalances) FirebaseSyncService.saveBankBalances(cleanedBalances);
      }
    });

    const unsubConfig = FirebaseSyncService.subscribeToFormulaConfig((remoteConfig) => {
      if (remoteConfig) {
        setPurchaseFormulaConfig((prev) => ({ ...prev, ...removeLegacyMarketRates(remoteConfig) }));
      }
    });

    const unsubContacts = FirebaseSyncService.subscribeContacts((remoteContacts) => {
      if (remoteContacts.length > 0) {
        setContacts(remoteContacts as Contact[]);
      }
    });

    const unsubOperations = FirebaseSyncService.subscribeOperations((remoteOps) => {
      if (remoteOps.length > 0) {
        setOperations(remoteOps as any[]);
      }
    });

    const unsubSales = FirebaseSyncService.subscribeSaleRecords((remoteSales) => {
      hasSyncedSalesRef.current = true;
      const validRemote = (remoteSales as Partial<SaleRecord>[]).filter(
        (item): item is SaleRecord =>
          Boolean(item && item.id && item.reference && Array.isArray(item.bars) && typeof item.grossRevenueUsd === 'number')
      );
      if (validRemote.length > 0) {
        setSaleRecords((prev) => {
          const merged = new Map<string, SaleRecord>();
          for (const localSale of prev) {
            if (!INITIAL_SALE_RECORDS.some((seed) => seed.id === localSale.id)) {
              merged.set(localSale.id, localSale);
            }
          }
          for (const remoteSale of validRemote) {
            merged.set(remoteSale.id, remoteSale);
          }
          return Array.from(merged.values()).sort((a, b) =>
            (b.createdAt || '').localeCompare(a.createdAt || '')
          );
        });
      }
    });

    const unsubTasks = FirebaseSyncService.subscribeTasks((remoteTasks) => {
      if (remoteTasks.length > 0) {
        setTasks(remoteTasks as AppTask[]);
      }
    });

    return () => {
      unsubPurchases();
      unsubStock();
      unsubAccounts();
      unsubConfig();
      unsubContacts();
      unsubOperations();
      unsubSales();
      unsubTasks();
    };
  }, [isSignedIn]);

  const totalTreasury = Object.values(bankBalances).reduce((acc, curr) => acc + curr, 0);

  const averagePurchaseCostPerFineGramXaf = computeAveragePurchaseCostPerFineGramXaf(purchases);

  const fallbackUsdToXafRate =
    purchaseFormulaConfig.blackMarketUsdRate ||
    purchaseFormulaConfig.officialUsdRate ||
    0;

  const goldProfitFromRecords = saleRecords.reduce((acc, sale) => {
    const breakdown = computeSaleProfitBreakdown({
      sale,
      purchases,
      fallbackUsdToXafRate,
      averageCostPerFineGramXaf: averagePurchaseCostPerFineGramXaf,
    });
    return acc + breakdown.netProfitXaf;
  }, 0);

  const legacyGoldProfit =
    saleRecords.length === 0
      ? sales.reduce((acc, sale) => {
          const match = sale.match(/bénéfice\s+(-?[0-9\s]+)\s+FCFA/i);
          if (!match) return acc;
          const digits = match[1].replace(/[^0-9-]/g, '');
          return digits ? acc + parseFloat(digits) : acc;
        }, 0)
      : 0;

  const goldProfit = goldProfitFromRecords + legacyGoldProfit;

  const currencyBuyStats = currencyStockMovements.reduce(
    (map, m) => {
      if (m.type === 'Achat devise' && m.amount > 0) {
        const qty = Math.abs(m.amount);
        const totalXaf = m.totalXaf && m.totalXaf > 0 ? m.totalXaf : qty * (m.rate || 0);
        if (totalXaf > 0) {
          const prev = map[m.currency] || { qty: 0, totalXaf: 0 };
          map[m.currency] = { qty: prev.qty + qty, totalXaf: prev.totalXaf + totalXaf };
        }
      }
      return map;
    },
    {} as Record<string, { qty: number; totalXaf: number }>
  );

  const currencyProfit = currencyStockMovements.reduce((acc, m) => {
    if (m.type !== 'Vente devise') return acc;
    const soldQty = Math.abs(m.amount || 0);
    if (soldQty <= 0) return acc;
    const saleXaf =
      m.totalXaf && m.totalXaf > 0 ? m.totalXaf : Math.round(soldQty * (m.rate || 0));
    if (saleXaf <= 0) return acc;

    const buyStat = currencyBuyStats[m.currency];
    if (buyStat && buyStat.qty > 0) {
      const avgBuyRate = buyStat.totalXaf / buyStat.qty;
      const costXaf = Math.round(soldQty * avgBuyRate);
      return acc + (saleXaf - costXaf);
    }

    if (m.currency === 'USD' && purchaseFormulaConfig.officialUsdRate > 0) {
      const costXaf = Math.round(soldQty * purchaseFormulaConfig.officialUsdRate);
      return acc + (saleXaf - costXaf);
    }

    return acc;
  }, 0);

  const totalProfit = goldProfit + currencyProfit;

  const unprocessedOperations = operations.filter((op) => !op.isProcessed);
  const contactsWithAppointments = contacts.filter((c) => Boolean(c.appointment));

  const signIn = async (email: string, password: string) => {
    setAuthMessage('');
    await signInWithEmailAndPassword(auth, email.trim(), password);
  };

  const signInWithGoogle = async () => {
    setAuthMessage('');
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const register = async ({
    name,
    email,
    phone,
    requestedRole,
    password,
  }: {
    name: string;
    email: string;
    phone: string;
    requestedRole: AppRole;
    password: string;
  }) => {
    registrationInProgress.current = true;
    setAuthMessage('');
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(credential.user, { displayName: name.trim() });
      await sendEmailVerification(credential.user);
      await setDoc(doc(db, 'pending_users', credential.user.uid), {
        name: name.trim(),
        email: credential.user.email,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        requestedRole,
        createdAt: serverTimestamp(),
      });
      setAuthEmail(credential.user.email || email.trim());
      setUserName(name.trim());
      setAuthStatus('unverified');
    } catch (error) {
      await firebaseSignOut(auth);
      setAuthStatus('signedOut');
      throw error;
    } finally {
      registrationInProgress.current = false;
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
  };

  const refreshAuthorization = async () => {
    const user = auth.currentUser;
    if (!user) {
      setAuthStatus('signedOut');
      return;
    }

    setAuthStatus('loading');
    setAuthMessage('');
    try {
      await reload(user);
      const access = await resolveAuthAccess(user);
      setAuthStatus(access.status);
      setUserName(access.name);
      setAuthEmail(user.email || '');
      if (access.role) setCurrentRoleState(access.role);
      setCurrentUserIdState(user.uid);
      setProfileAllowedModules(access.allowedModules);
      setProfileAllowedServices(access.allowedServices);
    } catch (error) {
      console.error('Firebase authorization refresh failed:', error);
      setAuthStatus('error');
      setAuthMessage('Impossible de vérifier vos droits. Vérifiez votre connexion puis réessayez.');
      throw error;
    }
  };

  const resendVerificationEmail = async () => {
    const user = auth.currentUser;
    if (!user) throw new Error('Aucun compte connecté.');
    await sendEmailVerification(user);
  };

  const depositCash = ({
    amount,
    depositorName,
    reason,
    date,
    reference,
    account,
  }: {
    amount: number;
    depositorName: string;
    reason: string;
    date?: string;
    reference?: string;
    account?: string;
  }) => {
    if (amount <= 0 || !Number.isFinite(amount)) {
      throw new Error('Le montant du dépôt doit être strictement positif.');
    }
    const cashKey = Object.keys(bankBalances).find((k) => k.toLowerCase().includes('caisse')) || 'Caisse (espèces)';
    const targetAccount = account && bankBalances[account] !== undefined ? account : cashKey;
    const updatedBalances = {
      ...bankBalances,
      [targetAccount]: (bankBalances[targetAccount] ?? 0) + amount,
    };
    setBankBalances(updatedBalances);
    FirebaseSyncService.saveBankBalances(updatedBalances);

    const parsedDate =
      date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00`) : null;
    const displayDate =
      parsedDate && !Number.isNaN(parsedDate.getTime())
        ? parsedDate.toLocaleDateString('fr-FR')
        : date || 'Aujourd’hui';
    const createdAtIso =
      parsedDate && !Number.isNaN(parsedDate.getTime())
        ? parsedDate.toISOString()
        : new Date().toISOString();

    const cleanContact = depositorName.trim() || 'Gérant';
    const cleanReason = reason.trim() || 'Dépôt au compte';
    const refStr = reference?.trim() || `DEP-${Date.now().toString().slice(-6)}`;
    const newEntry: LedgerEntry = {
      id: `op-cashdep-${Date.now()}`,
      title: `Dépôt · ${cleanContact}`,
      subtitle: `${targetAccount} · ${cleanReason}`,
      amount,
      date: displayDate,
      createdAt: createdAtIso,
      isIncome: true,
      isTransfer: false,
      isCashDeposit: true,
      depositor: cleanContact,
      notes: cleanReason,
      reference: refStr,
      account: targetAccount,
      isProcessed: true,
    };
    setOperations((prev) => [newEntry, ...prev]);
    FirebaseSyncService.saveOperation(newEntry);
  };

  const withdrawCash = ({
    amount,
    beneficiaryName,
    reason,
    date,
    reference,
    account,
  }: {
    amount: number;
    beneficiaryName: string;
    reason: string;
    date?: string;
    reference?: string;
    account?: string;
  }) => {
    if (amount <= 0 || !Number.isFinite(amount)) {
      throw new Error('Le montant du retrait doit être strictement positif.');
    }
    const cashKey = Object.keys(bankBalances).find((k) => k.toLowerCase().includes('caisse')) || 'Caisse (espèces)';
    const targetAccount = account && bankBalances[account] !== undefined ? account : cashKey;
    const curBal = bankBalances[targetAccount] ?? 0;
    const updatedBalances = {
      ...bankBalances,
      [targetAccount]: curBal - amount,
    };
    setBankBalances(updatedBalances);
    FirebaseSyncService.saveBankBalances(updatedBalances);

    const parsedDate =
      date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00`) : null;
    const displayDate =
      parsedDate && !Number.isNaN(parsedDate.getTime())
        ? parsedDate.toLocaleDateString('fr-FR')
        : date || 'Aujourd’hui';
    const createdAtIso =
      parsedDate && !Number.isNaN(parsedDate.getTime())
        ? parsedDate.toISOString()
        : new Date().toISOString();

    const cleanContact = beneficiaryName.trim() || 'Bénéficiaire';
    const cleanReason = reason.trim() || 'Retrait en cash';
    const refStr = reference?.trim() || `RET-${Date.now().toString().slice(-6)}`;
    const newEntry: LedgerEntry = {
      id: `op-cashret-${Date.now()}`,
      title: `Retrait · ${cleanContact}`,
      subtitle: `${targetAccount} · ${cleanReason}`,
      amount,
      date: displayDate,
      createdAt: createdAtIso,
      isIncome: false,
      isTransfer: false,
      isCashWithdrawal: true,
      beneficiary: cleanContact,
      notes: cleanReason,
      reference: refStr,
      account: targetAccount,
      isProcessed: true,
    };
    setOperations((prev) => [newEntry, ...prev]);
    FirebaseSyncService.saveOperation(newEntry);
  };

  const editOperation = (operationId: string, updates: Partial<LedgerEntry>) => {
    setOperations((prev) => {
      const idx = prev.findIndex((o) => o.id === operationId);
      if (idx === -1) return prev;
      const oldOp = prev[idx];
      const updatedOp = { ...oldOp, ...updates };

      if (updates.amount !== undefined && updates.amount !== oldOp.amount) {
        const diff = updates.amount - oldOp.amount;
        const targetAcc = updatedOp.account || (oldOp.subtitle.includes('Banque') ? 'Ecobank' : 'Caisse (espèces)');
        const curBal = bankBalances[targetAcc] ?? 0;
        const newBal = updatedOp.isIncome ? curBal + diff : curBal - diff;
        const updatedBals = { ...bankBalances, [targetAcc]: newBal };
        setBankBalances(updatedBals);
        FirebaseSyncService.saveBankBalances(updatedBals);
      }

      const copy = [...prev];
      copy[idx] = updatedOp;
      return copy;
    });
  };

  const addContact = (contactData: Omit<Contact, 'reference'>) => {
    const lastNum = contacts.reduce((max, c) => {
      const match = c.reference.match(/^CLI-(\d+)$/);
      const num = match ? parseInt(match[1], 10) : 0;
      return num > max ? num : max;
    }, 0);
    const nextRef = `CLI-${String(lastNum + 1).padStart(5, '0')}`;
    const newContact: Contact = {
      ...contactData,
      reference: nextRef,
      id: `cont-${Date.now()}`,
    };
    setContacts([newContact, ...contacts]);
    FirebaseSyncService.saveContact(newContact);
  };

  const updateContact = (contactRef: string, updates: Partial<Omit<Contact, 'reference'>>) => {
    setContacts((previousContacts) =>
      previousContacts.map((contact) => {
        if (contact.reference === contactRef) {
          const updated = { ...contact, ...updates, reference: contact.reference };
          FirebaseSyncService.saveContact(updated);
          return updated;
        }
        return contact;
      })
    );
  };

  const saveAppointment = (contactRef: string, appointment: string) => {
    setContacts(
      contacts.map((c) => {
        if (c.reference === contactRef) {
          const updated = { ...c, appointment };
          FirebaseSyncService.saveContact(updated);
          return updated;
        }
        return c;
      })
    );
  };

  const removeAppointment = (contactRef: string) => {
    setContacts(
      contacts.map((c) => (c.reference === contactRef ? { ...c, appointment: null } : c))
    );
  };

  const markOperationProcessed = (operationId: string) => {
    setOperations(
      operations.map((op) => (op.id === operationId ? { ...op, isProcessed: true } : op))
    );
  };

  const addBank = (bankName: string, openingBalance: number) => {
    const trimmedName = bankName.trim();
    if (!trimmedName) throw new Error('Le nom de la banque est requis.');
    if (bankBalances[trimmedName] !== undefined) {
      throw new Error('Un compte portant ce nom existe déjà.');
    }
    if (openingBalance < 0 || !Number.isFinite(openingBalance)) {
      throw new Error("Le solde d'ouverture doit être un montant valide et positif ou nul.");
    }
    const updatedBalances = {
      ...bankBalances,
      [trimmedName]: openingBalance,
    };
    setBankBalances(updatedBalances);
    FirebaseSyncService.saveBankBalances(updatedBalances);
  };

  const deleteBank = (bankName: string) => {
    const balance = bankBalances[bankName];
    if (balance === undefined) {
      throw new Error('Ce compte bancaire est introuvable.');
    }
    if (bankName.toLowerCase().includes('caisse')) {
      throw new Error('Le compte caisse ne peut pas être supprimé.');
    }
    if (balance !== 0) {
      throw new Error('Pour supprimer ce compte, son solde doit être nul.');
    }

    const updatedBalances = { ...bankBalances };
    delete updatedBalances[bankName];
    setBankBalances(updatedBalances);
    FirebaseSyncService.saveBankBalances(updatedBalances);
  };

  const addMovement = (bank: string, amount: number, deposit: boolean, label: string) => {
    const current = bankBalances[bank] ?? 0;
    const nextBalance = deposit ? current + amount : current - amount;
    setBankBalances({
      ...bankBalances,
      [bank]: nextBalance,
    });
    const newEntry: LedgerEntry = {
      id: `op-${Date.now()}`,
      title: label,
      subtitle: bank,
      amount,
      date: 'Aujourd’hui',
      isIncome: deposit,
      isDeposit: deposit,
      isProcessed: true,
    };
    setOperations([newEntry, ...operations]);
  };

  const transferFunds = ({
    fromAccount,
    toAccount,
    amount,
    label,
  }: {
    fromAccount: string;
    toAccount: string;
    amount: number;
    label: string;
  }) => {
    if (bankBalances[fromAccount] === undefined || bankBalances[toAccount] === undefined) {
      throw new Error('Le compte sélectionné est introuvable.');
    }
    if (fromAccount === toAccount) {
      throw new Error('Les comptes source et destination doivent différer.');
    }
    if (amount <= 0 || !Number.isFinite(amount)) {
      throw new Error("Le montant de l'approvisionnement doit être positif.");
    }

    const updatedBalances = {
      ...bankBalances,
      [fromAccount]: bankBalances[fromAccount] - amount,
      [toAccount]: bankBalances[toAccount] + amount,
    };
    setBankBalances(updatedBalances);
    FirebaseSyncService.saveBankBalances(updatedBalances);

    const newEntry: LedgerEntry = {
      id: `op-${Date.now()}`,
      title: `Appro · ${label.trim()}`,
      subtitle: `${fromAccount} → ${toAccount}`,
      amount,
      date: 'Aujourd’hui',
      isTransfer: true,
      isProcessed: true,
    };
    setOperations([newEntry, ...operations]);
  };

  const transferToClient = ({
    fromAccount,
    clientName,
    clientBank,
    clientAccountNumber,
    clientBankAgency,
    clientAccountHolder,
    clientBankReference,
    amount,
    feeAmount = 0,
    reason,
  }: {
    fromAccount: string;
    clientName: string;
    clientBank?: string;
    clientAccountNumber?: string;
    clientBankAgency?: string;
    clientAccountHolder?: string;
    clientBankReference?: string;
    amount: number;
    feeAmount?: number;
    reason?: string;
  }) => {
    if (bankBalances[fromAccount] === undefined) {
      throw new Error('Le compte source sélectionné est introuvable.');
    }
    if (!clientName || !clientName.trim()) {
      throw new Error('Le nom du client bénéficiaire est requis.');
    }
    if (amount <= 0 || !Number.isFinite(amount)) {
      throw new Error('Le montant du virement doit être positif.');
    }
    const safeFee = feeAmount && Number.isFinite(feeAmount) && feeAmount > 0 ? feeAmount : 0;
    const totalDebit = amount + safeFee;

    const updatedBalances = {
      ...bankBalances,
      [fromAccount]: bankBalances[fromAccount] - totalDebit,
    };
    setBankBalances(updatedBalances);
    FirebaseSyncService.saveBankBalances(updatedBalances);

    const cleanReason = reason?.trim() || 'Règlement virement client';
    const targetDetails = [
      clientBank?.trim(),
      clientAccountNumber?.trim() ? `N° ${clientAccountNumber.trim()}` : '',
    ]
      .filter(Boolean)
      .join(' - ') || 'Compte bancaire client';

    const newEntry: LedgerEntry = {
      id: `op-cltr-${Date.now()}`,
      title: `Virement client · ${clientName.trim()}`,
      subtitle: `${fromAccount} → ${targetDetails}${safeFee > 0 ? ` (frais : ${safeFee.toLocaleString('fr-FR')} F)` : ''} · ${cleanReason}`,
      amount: totalDebit,
      date: 'Aujourd’hui',
      isIncome: false,
      isTransfer: false,
      isClientTransfer: true,
      isProcessed: true,
      clientTransferDetails: {
        fromAccount,
        clientName: clientName.trim(),
        clientBank: clientBank?.trim() || '',
        clientAccountNumber: clientAccountNumber?.trim() || '',
        clientBankAgency: clientBankAgency?.trim() || '',
        clientAccountHolder: clientAccountHolder?.trim() || '',
        clientBankReference: clientBankReference?.trim() || '',
        feeAmount: safeFee,
        reason: cleanReason,
      },
    };
    setOperations([newEntry, ...operations]);
    return newEntry;
  };

  const addCashToBankDeposit = ({
    targetBank,
    amount,
    slipNumber,
    depositedBy,
    date,
    note,
    bankGroupName,
    accountNumber,
    accountHolder,
    accountAddress,
    amountInWords,
    depositorAddress,
    depositorPhone,
    depositorEmail,
    orderOf,
    forAccountOf,
    provenanceFonds,
    shiftPeriod,
    denominations,
  }: {
    targetBank: string;
    amount: number;
    slipNumber?: string;
    depositedBy?: string;
    date?: string;
    note?: string;
    bankGroupName?: string;
    accountNumber?: string;
    accountHolder?: string;
    accountAddress?: string;
    amountInWords?: string;
    depositorAddress?: string;
    depositorPhone?: string;
    depositorEmail?: string;
    orderOf?: string;
    forAccountOf?: string;
    provenanceFonds?: string;
    shiftPeriod?: 'Matin' | 'Soir';
    denominations?: DepositDenominations;
  }) => {
    // Determine cash account
    const cashAccountKey =
      Object.keys(bankBalances).find((k) => k.toLowerCase().includes('caisse')) || 'Caisse (espèces)';

    const cashBal = bankBalances[cashAccountKey] ?? 0;
    if (bankBalances[targetBank] === undefined) {
      throw new Error(`Le compte bancaire de destination "${targetBank}" est introuvable.`);
    }
    if (targetBank === cashAccountKey) {
      throw new Error('Le compte bancaire de destination ne peut pas être la caisse.');
    }
    if (amount <= 0 || !Number.isFinite(amount)) {
      throw new Error('Le montant du versement doit être supérieur à zéro.');
    }

    const updatedBalances = {
      ...bankBalances,
      [cashAccountKey]: cashBal - amount,
      [targetBank]: (bankBalances[targetBank] ?? 0) + amount,
    };
    setBankBalances(updatedBalances);
    FirebaseSyncService.saveBankBalances(updatedBalances);

    const cleanSlip = slipNumber?.trim() ? `Bordereau N° ${slipNumber.trim()}` : '';
    const cleanDepositor = depositedBy?.trim() ? `Déposant : ${depositedBy.trim()}` : '';
    const cleanNote = note?.trim() || "Versement d'espèces en banque";
    const subtitleDetails = [cleanSlip, cleanDepositor, cleanNote].filter(Boolean).join(' · ');

    const newEntry: LedgerEntry = {
      id: `op-dep-${Date.now()}`,
      title: `Versement bancaire · ${cashAccountKey} → ${targetBank}`,
      subtitle: subtitleDetails,
      amount,
      date: date || 'Aujourd’hui',
      isIncome: false,
      isTransfer: true,
      isDeposit: true,
      isProcessed: true,
      depositDetails: {
        fromAccount: cashAccountKey,
        targetBank,
        bankGroupName: bankGroupName?.trim() || '',
        accountNumber: accountNumber?.trim() || '',
        accountHolder: accountHolder?.trim() || 'CAMS GOLD COMPTOIR SARL',
        accountAddress: accountAddress?.trim() || '',
        amount,
        amountInWords: amountInWords?.trim() || '',
        slipNumber: slipNumber?.trim() || '',
        depositedBy: depositedBy?.trim() || '',
        depositorAddress: depositorAddress?.trim() || '',
        depositorPhone: depositorPhone?.trim() || '',
        depositorEmail: depositorEmail?.trim() || '',
        orderOf: orderOf?.trim() || '',
        forAccountOf: forAccountOf?.trim() || '',
        provenanceFonds: provenanceFonds?.trim() || '',
        shiftPeriod: shiftPeriod || 'Matin',
        note: cleanNote,
        denominations,
      },
    };
    setOperations([newEntry, ...operations]);
  };

  const addExpense = ({
    account,
    amount,
    description,
    date,
    contactName,
  }: {
    account: string;
    amount: number;
    description: string;
    date: string;
    contactName?: string;
  }) => {
    if (bankBalances[account] === undefined) {
      throw new Error('Le compte sélectionné est introuvable.');
    }
    if (amount <= 0 || !Number.isFinite(amount)) {
      throw new Error('Le montant de la dépense doit être positif.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T12:00:00`).getTime())) {
      throw new Error('Veuillez sélectionner une date valide pour la dépense.');
    }

    const updatedBalances = {
      ...bankBalances,
      [account]: bankBalances[account] - amount,
    };
    setBankBalances(updatedBalances);
    FirebaseSyncService.saveBankBalances(updatedBalances);

    const cleanContact = contactName?.trim();
    const newEntry: LedgerEntry = {
      id: `op-${Date.now()}`,
      title: `Dépense OPEX · ${description.trim()}`,
      subtitle: cleanContact ? `${account} · ${cleanContact}` : account,
      amount,
      date: new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR'),
      createdAt: new Date(`${date}T12:00:00`).toISOString(),
      account,
      beneficiary: cleanContact || undefined,
      notes: description.trim(),
      isIncome: false,
      isProcessed: true,
    };
    setOperations([newEntry, ...operations]);
    FirebaseSyncService.saveOperation(newEntry);
  };

  const stockWeightForKarat = (karat: string, category?: string): number => {
    const total = stockMovements
      .filter(
        (m) =>
          m.karat === karat &&
          (!category || m.category === category || m.category === 'Non catégorisé' || !m.category)
      )
      .reduce((sum, m) => sum + m.weightGrams, 0);

    return total;
  };

  const addPurchases = (purchaseInputs: PurchaseInput[]) => {
    if (purchaseInputs.length === 0) return [];

    const totalPaymentsByAccount: Record<string, number> = {};
    for (const input of purchaseInputs) {
      if (input.price <= 0 || !Number.isFinite(input.price)) {
        throw new Error('Le montant de chaque achat doit être positif.');
      }
      const paidAmount = input.initialPaymentAmount !== undefined
        ? input.initialPaymentAmount
        : (input.paymentAccount ? input.price : 0);
      if (paidAmount < 0 || paidAmount > input.price) {
        throw new Error('Le paiement initial doit être compris entre zéro et le montant de chaque achat.');
      }
      if (paidAmount > 0 && !input.paymentAccount) {
        throw new Error('Choisissez un compte pour le paiement initial.');
      }
      if (input.paymentAccount && paidAmount > 0) {
        totalPaymentsByAccount[input.paymentAccount] =
          (totalPaymentsByAccount[input.paymentAccount] ?? 0) + paidAmount;
      }
    }

    const year = new Date().getFullYear();
    const existingYearPurchases = purchases.filter((purchase) =>
      purchase.reference?.startsWith(`ACH-${year}-`)
    ).length;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const newPurchases: PurchaseRecord[] = [];
    const newMovements: GoldStockMovement[] = [];
    const newOperations: LedgerEntry[] = [];

    purchaseInputs.forEach((input, index) => {
      const {
        description,
        price,
        paymentAccount,
        initialPaymentAmount,
        reference,
        supplier,
        grossWeightGrams,
        nonGoldWeightGrams = 0,
        karat,
        goldCategory = 'Or brut',
        purityPercent,
        referencePricePerGram,
        discountPercent,
        goldPricePerTroyOunceUsd,
        usdToXafRate,
        rateObservedAt,
      } = input;
      const paidAmount = initialPaymentAmount !== undefined
        ? initialPaymentAmount
        : (paymentAccount ? price : 0);
      const autoRef = reference ||
        `ACH-${year}-${String(existingYearPurchases + index + 1).padStart(4, '0')}`;
      const netWeight = (grossWeightGrams || 0) - nonGoldWeightGrams;
      const validNetWeight = netWeight > 0 ? netWeight : (grossWeightGrams || 0);
      const idSuffix = `${now}-${index}`;
      const payments: PurchasePayment[] = paidAmount > 0 && paymentAccount
        ? [{
            amount: paidAmount,
            paidAt: nowIso,
            method: paidAmount === price ? 'Paiement immédiat' : 'Avance',
            account: paymentAccount,
          }]
        : [];
      const purchase: PurchaseRecord = {
        id: `purch-${idSuffix}`,
        reference: autoRef,
        description,
        amount: price,
        purchasedAt: nowIso,
        supplier,
        grossWeightGrams,
        nonGoldWeightGrams,
        netWeightGrams: validNetWeight,
        karat,
        goldCategory,
        purityPercent,
        referencePricePerGram,
        discountPercent,
        goldPricePerTroyOunceUsd,
        usdToXafRate,
        rateObservedAt,
        payments,
      };
      newPurchases.push(purchase);
      FirebaseSyncService.savePurchase(purchase);

      if (validNetWeight > 0 && karat) {
        const movement: GoldStockMovement = {
          id: `mov-${idSuffix}`,
          label: `Achat · ${supplier || 'Fournisseur'} (${autoRef})`,
          karat,
          weightGrams: validNetWeight,
          date: nowIso,
          type: 'Achat',
          category: goldCategory,
          reason: `Achat comptoir ${autoRef} (Brut ${(grossWeightGrams || 0).toFixed(2)}g, non-or ${nonGoldWeightGrams.toFixed(2)}g)`,
          referenceId: autoRef,
        };
        newMovements.push(movement);
        FirebaseSyncService.saveStockMovement(movement);
      }

      newOperations.push({
        id: `op-${idSuffix}`,
        title: 'Nouvel achat d’or',
        subtitle: description,
        amount: price,
        date: 'Aujourd’hui',
        isIncome: false,
        isProcessed: true,
      });
    });

    setPurchases([...newPurchases, ...purchases]);
    setStockMovements([...newMovements, ...stockMovements]);
    setOperations([...newOperations, ...operations]);

    if (Object.keys(totalPaymentsByAccount).length > 0) {
      const updatedBalances = { ...bankBalances };
      for (const [account, amount] of Object.entries(totalPaymentsByAccount)) {
        updatedBalances[account] = (updatedBalances[account] ?? 0) - amount;
      }
      setBankBalances(updatedBalances);
      FirebaseSyncService.saveBankBalances(updatedBalances);
    }

    return newPurchases;
  };

  const addPurchase = (purchaseInput: PurchaseInput) => {
    addPurchases([purchaseInput]);
  };

  const updatePurchase = (purchaseId: string, updates: PurchaseInput) => {
    const purchase = purchases.find((item) => item.id === purchaseId);
    if (!purchase || purchase.cancelledAt) {
      throw new Error('Cet achat ne peut pas être modifié.');
    }
    if (!Number.isFinite(updates.price) || updates.price <= 0) {
      throw new Error('Le montant de l’achat doit être positif.');
    }

    const paidAmount = purchase.payments.reduce((sum, payment) => sum + payment.amount, 0);
    if (updates.price < paidAmount) {
      throw new Error('Le montant de l’achat ne peut pas être inférieur aux paiements déjà enregistrés.');
    }

    const grossWeight = updates.grossWeightGrams ?? 0;
    const nonGoldWeight = updates.nonGoldWeightGrams ?? 0;
    const netWeight = grossWeight - nonGoldWeight;
    const karat = updates.karat?.trim() ?? '';
    const category = updates.goldCategory ?? 'Or brut';
    if (
      !Number.isFinite(grossWeight) ||
      !Number.isFinite(nonGoldWeight) ||
      netWeight <= 0 ||
      !isValidGoldKarat(karat)
    ) {
      throw new Error('Les poids et le carat de l’achat sont invalides.');
    }

    const previousNetWeight = purchase.netWeightGrams || 0;
    const previousKarat = purchase.karat || '';

    const nowIso = new Date().toISOString();
    const editTimestamp = Date.now();
    const stockAdjustments: GoldStockMovement[] = [];
    if (previousNetWeight > 0 && previousKarat) {
      stockAdjustments.push({
        id: `mov-edit-${purchase.id}-${editTimestamp}-out`,
        label: `Modification achat · ${purchase.reference}`,
        karat: previousKarat,
        weightGrams: -previousNetWeight,
        date: nowIso,
        type: 'Modification achat',
        category: purchase.goldCategory,
        reason: `Retrait de l’ancienne quantité avant modification de ${purchase.reference}`,
        referenceId: purchase.reference,
      });
    }
    stockAdjustments.push({
      id: `mov-edit-${purchase.id}-${editTimestamp}-in`,
      label: `Modification achat · ${purchase.reference}`,
      karat,
      weightGrams: netWeight,
      date: nowIso,
      type: 'Modification achat',
      category,
      reason: `Ajout de la nouvelle quantité après modification de ${purchase.reference}`,
      referenceId: purchase.reference,
    });

    const updatedPurchase: PurchaseRecord = {
      ...purchase,
      description: updates.description,
      amount: updates.price,
      supplier: updates.supplier,
      grossWeightGrams: grossWeight,
      nonGoldWeightGrams: nonGoldWeight,
      netWeightGrams: netWeight,
      karat,
      goldCategory: category,
      purityPercent: updates.purityPercent,
      referencePricePerGram: updates.referencePricePerGram,
      goldPricePerTroyOunceUsd: updates.goldPricePerTroyOunceUsd,
      usdToXafRate: updates.usdToXafRate,
      rateObservedAt: updates.rateObservedAt ?? purchase.rateObservedAt,
    };

    setPurchases(purchases.map((item) => (item.id === purchaseId ? updatedPurchase : item)));
    setStockMovements([...stockAdjustments, ...stockMovements]);
    FirebaseSyncService.savePurchase(updatedPurchase);
    stockAdjustments.forEach((movement) => FirebaseSyncService.saveStockMovement(movement));

    const operationId = purchase.id.startsWith('purch-')
      ? `op-${purchase.id.slice('purch-'.length)}`
      : '';
    if (operationId && operations.some((operation) => operation.id === operationId)) {
      setOperations(
        operations.map((operation) =>
          operation.id === operationId
            ? { ...operation, subtitle: updates.description, amount: updates.price }
            : operation
        )
      );
    }
  };

  const addPurchasePayment = (purchaseId: string, paymentData: Omit<PurchasePayment, 'paidAt'>) => {
    const purchase = purchases.find((p) => p.id === purchaseId);
    if (!purchase || purchase.cancelledAt) {
      throw new Error('Cet achat ne peut pas recevoir de paiement.');
    }
    const currentPaid = purchase.payments.reduce((sum, p) => sum + p.amount, 0);
    const remaining = purchase.amount - currentPaid;
    if (paymentData.amount <= 0 || paymentData.amount > remaining) {
      throw new Error('Le montant du paiement est invalide.');
    }
    if (paymentData.account) {
      const avail = bankBalances[paymentData.account] ?? 0;
      const updatedBalances = {
        ...bankBalances,
        [paymentData.account]: avail - paymentData.amount,
      };
      setBankBalances(updatedBalances);
      FirebaseSyncService.saveBankBalances(updatedBalances);
    }

    const newPayment: PurchasePayment = {
      ...paymentData,
      paidAt: new Date().toISOString(),
    };

    const updatedPurchase = {
      ...purchase,
      payments: [...purchase.payments, newPayment],
    };

    setPurchases(
      purchases.map((p) => (p.id === purchaseId ? updatedPurchase : p))
    );
    FirebaseSyncService.savePurchase(updatedPurchase);
  };

  const cancelPurchase = (purchaseId: string, reason: string) => {
    if (currentRole !== 'ADMIN') {
      throw new Error('Seul un administrateur peut annuler un achat enregistré.');
    }
    const purchase = purchases.find((p) => p.id === purchaseId);
    if (!purchase || purchase.cancelledAt) {
      throw new Error('Cet achat est déjà annulé ou introuvable.');
    }
    if (!reason.trim()) {
      throw new Error('Le motif d’annulation est obligatoire.');
    }

    if (purchase.netWeightGrams && purchase.karat) {
      // Automatic stock deduction on purchase cancellation
      const cancelMovement: GoldStockMovement = {
        id: `mov-${Date.now()}`,
        label: `Annulation achat · ${purchase.reference}`,
        karat: purchase.karat,
        weightGrams: -(purchase.netWeightGrams || 0),
        date: new Date().toISOString(),
        type: 'Annulation',
        category: purchase.goldCategory || 'Or brut',
        reason: `Annulation achat : ${reason.trim()}`,
        referenceId: purchase.reference,
      };
      setStockMovements([cancelMovement, ...stockMovements]);
      FirebaseSyncService.saveStockMovement(cancelMovement);
    }

    // Refund payments
    const updatedBalances = { ...bankBalances };
    const refundOps: LedgerEntry[] = [];
    for (const payment of purchase.payments) {
      if (payment.account) {
        updatedBalances[payment.account] = (updatedBalances[payment.account] || 0) + payment.amount;
        refundOps.push({
          id: `op-ref-${Date.now()}-${Math.random()}`,
          title: 'Remboursement d’achat annulé',
          subtitle: `${purchase.reference} · ${payment.account}`,
          amount: payment.amount,
          date: 'Aujourd’hui',
          isIncome: true,
          isProcessed: true,
        });
      }
    }

    setBankBalances(updatedBalances);
    FirebaseSyncService.saveBankBalances(updatedBalances);
    setOperations([...refundOps, ...operations]);

    const updatedPurchase: PurchaseRecord = {
      ...purchase,
      cancelledAt: new Date().toISOString(),
      cancellationReason: reason.trim(),
    };

    setPurchases(
      purchases.map((p) => (p.id === purchaseId ? updatedPurchase : p))
    );
    FirebaseSyncService.savePurchase(updatedPurchase);
  };

  const adjustGoldStock = ({
    karat,
    category = 'Non catégorisé',
    weightGrams,
    reason,
  }: {
    karat: string;
    category?: string;
    weightGrams: number;
    reason: string;
  }) => {
    if (!isValidGoldKarat(karat)) {
      throw new Error('Le carat sélectionné n’est pas valide.');
    }
    if (!weightGrams || !Number.isFinite(weightGrams)) {
      throw new Error('La correction doit avoir un poids non nul.');
    }
    if (!reason.trim()) {
      throw new Error('Le motif de correction est obligatoire.');
    }

    const movement: GoldStockMovement = {
      id: `mov-${Date.now()}`,
      label: 'Correction de stock',
      karat,
      weightGrams,
      date: new Date().toISOString(),
      type: 'Correction',
      category,
      reason: reason.trim(),
    };

    setStockMovements([movement, ...stockMovements]);
    FirebaseSyncService.saveStockMovement(movement);
  };

  const buildGoldStockReconciliationMovements = (
    currentMovements: GoldStockMovement[],
    targetPurchases: PurchaseRecord[],
    targetSaleRecords: SaleRecord[],
    saleRef?: string
  ): GoldStockMovement[] => {
    const normalizeCat = (
      category?: string
    ): 'Or brut' | 'Or fondu' | 'Bijoux' | 'Non catégorisé' => {
      if (category === 'Or fondu') return 'Or fondu';
      if (category === 'Bijoux') return 'Bijoux';
      if (category === 'Non catégorisé') return 'Non catégorisé';
      return 'Or brut';
    };

    const currentByKey: Record<string, number> = {};
    for (const mov of currentMovements) {
      const karat = mov.karat || '24K';
      const cat = normalizeCat(mov.category);
      const key = `${karat}|||${cat}`;
      currentByKey[key] = (currentByKey[key] ?? 0) + (Number.isFinite(mov.weightGrams) ? mov.weightGrams : 0);
    }

    const unsoldPurchases = getUnsoldPurchases(
      targetPurchases,
      targetSaleRecords,
      currentMovements
    );
    const expectedByKey: Record<string, number> = {};
    for (const purchase of unsoldPurchases) {
      const netWeight =
        purchase.netWeightGrams ??
        Math.max(0, (purchase.grossWeightGrams || 0) - (purchase.nonGoldWeightGrams || 0));
      if (!purchase.karat || !Number.isFinite(netWeight) || netWeight <= 0) continue;
      const cat = normalizeCat(purchase.goldCategory);
      const key = `${purchase.karat}|||${cat}`;
      expectedByKey[key] = (expectedByKey[key] ?? 0) + netWeight;
    }

    const allKeys = Array.from(new Set([...Object.keys(currentByKey), ...Object.keys(expectedByKey)]));
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const corrections: GoldStockMovement[] = [];

    allKeys.forEach((key, index) => {
      const [karat, category] = key.split('|||');
      const current = currentByKey[key] ?? 0;
      const expected = expectedByKey[key] ?? 0;
      const delta = parseFloat((expected - current).toFixed(3));
      if (Math.abs(delta) <= 0.001) return;
      if (saleRef && delta > 0) return;

      corrections.push({
        id: `mov-reconcile-${now}-${index}`,
        label: saleRef
          ? `Solde fin de vente ${saleRef} · Perte de fonte / écart`
          : 'Régularisation stock vendu / perte de fonte',
        karat,
        weightGrams: delta,
        date: nowIso,
        type: 'Correction',
        category,
        reason: saleRef
          ? `Remise à zéro du stock après vente complète (${saleRef})`
          : 'Alignement du coffre physique avec les achats non vendus',
        referenceId: saleRef,
      });
    });

    return corrections;
  };

  const reconcileGoldStockWithUnsoldPurchases = (): number => {
    const corrections = buildGoldStockReconciliationMovements(
      stockMovements,
      purchases,
      saleRecords
    );
    if (corrections.length > 0) {
      corrections.forEach((movement) => FirebaseSyncService.saveStockMovement(movement));
      setStockMovements([...corrections, ...stockMovements]);
    }
    return corrections.length;
  };

  useEffect(() => {
    if (!isSignedIn || hasAutoReconciledSoldStockRef.current) return;
    if (!hasSyncedPurchasesRef.current || !hasSyncedStockRef.current || !hasSyncedSalesRef.current) return;
    if (purchases.length === 0 || saleRecords.length === 0) return;

    const unsoldPurchases = getUnsoldPurchases(purchases, saleRecords, stockMovements);
    if (unsoldPurchases.length > 0) return;

    const remainingOunces = calculateFineGoldStockOunces(stockMovements);
    if (remainingOunces <= 0.005) return;

    const latestSaleMs = Math.max(
      0,
      ...saleRecords.map((sale) => Date.parse(sale.createdAt || '')).filter((ms) => Number.isFinite(ms))
    );
    const hasPostSaleManualAddition = stockMovements.some((mov) => {
      if (mov.type !== 'Correction' || mov.weightGrams <= 0) return false;
      const movMs = Date.parse(mov.date || '');
      return Number.isFinite(movMs) && movMs > latestSaleMs;
    });
    if (hasPostSaleManualAddition) return;

    hasAutoReconciledSoldStockRef.current = true;
    const corrections = buildGoldStockReconciliationMovements(
      stockMovements,
      purchases,
      saleRecords
    );
    if (corrections.length > 0) {
      corrections.forEach((movement) => FirebaseSyncService.saveStockMovement(movement));
      setStockMovements((prev) => [...corrections, ...prev]);
    }
  }, [isSignedIn, purchases, stockMovements, saleRecords]);

  const addSale = ({
    description,
    profit,
    revenue,
    revenueUsd,
    weightGrams,
    karat,
    category,
    targetAccount = 'Caisse (espèces)',
  }: {
    description: string;
    profit: number;
    revenue?: number;
    revenueUsd?: number;
    weightGrams?: number;
    karat?: string;
    category?: string;
    targetAccount?: string;
  }) => {
    const saleId = `sale-${Date.now()}`;
    if (weightGrams !== undefined && karat !== undefined) {
      if (weightGrams <= 0 || !Number.isFinite(weightGrams)) {
        throw new Error('Le poids de la vente doit être supérieur à zéro.');
      }

      // Automatic stock deduction on sale
      const movement: GoldStockMovement = {
        id: `mov-${Date.now()}`,
        label: `Vente · ${description}`,
        karat,
        weightGrams: -weightGrams,
        date: new Date().toISOString(),
        type: 'Vente',
        category: category || 'Non catégorisé',
        reason: 'Sortie automatique de stock suite à vente d’or',
        referenceId: saleId,
      };
      setStockMovements([movement, ...stockMovements]);
      FirebaseSyncService.saveStockMovement(movement);
    }

    setSales([description, ...sales]);

    // Toute l'argent de la vente va directement dans la caisse
    const saleIncome = revenue !== undefined && revenue > 0 ? revenue : (profit > 0 ? profit : 0);
    const accountName = targetAccount || 'Caisse (espèces)';

    const updatedBalances = { ...bankBalances };
    if (saleIncome > 0) {
      updatedBalances[accountName] = (updatedBalances[accountName] ?? 0) + saleIncome;
      setBankBalances(updatedBalances);
      FirebaseSyncService.saveBankBalances(updatedBalances);
    }

    FirebaseSyncService.saveSaleRecord({
      id: saleId,
      description,
      profit,
      revenue: saleIncome,
      weightGrams: weightGrams || 0,
      karat: karat || '24K',
      category,
      targetAccount: accountName,
      date: new Date().toISOString(),
    });

    const newOp: LedgerEntry = {
      id: `op-${Date.now()}`,
      title: 'Vente d’or',
      subtitle: `${description} · Encaissé sur ${accountName}`,
      amount: saleIncome,
      date: 'Aujourd’hui',
      createdAt: new Date().toISOString(),
      weightOz: weightGrams ? weightGrams / TROY_OUNCE_IN_GRAMS : undefined,
      goldSaleDetails:
        revenueUsd !== undefined && Number.isFinite(revenueUsd) && revenueUsd > 0 && weightGrams
          ? {
              amountUsd: revenueUsd,
              ounces: weightGrams / TROY_OUNCE_IN_GRAMS,
            }
          : undefined,
      isIncome: true,
      isDeposit: true,
      isProcessed: true,
    };
    setOperations([newOp, ...operations]);
  };

  const addSaleRecord = (saleData: Omit<SaleRecord, 'id' | 'reference' | 'createdAt'>): SaleRecord => {
    const usdToXafRate = saleData.usdToXafRate ?? 0;
    if (!Number.isFinite(usdToXafRate) || usdToXafRate <= 0) {
      throw new Error('Un taux USD/XAF réel est nécessaire pour enregistrer la vente.');
    }
    const saleOunces = roundOunces(saleData.totalPureOunces);
    if (!Number.isFinite(saleOunces) || saleOunces <= 0) {
      throw new Error('La quantité vendue en onces doit être supérieure à zéro.');
    }
    if (saleData.advances.some((advance) =>
      !Number.isFinite(advance.amountUsd) ||
      advance.amountUsd < 0 ||
      (advance.currency === 'AED' &&
        (!Number.isFinite(advance.amountAed) || (advance.amountAed ?? 0) < 0))
    )) {
      throw new Error('Les montants des acomptes doivent être valides et positifs ou nuls.');
    }
    const lastNum = saleRecords.reduce((max, s) => {
      const match = s.reference?.match(/^VTE-(\d+)$/);
      const num = match ? parseInt(match[1], 10) : 0;
      return num > max ? num : max;
    }, 0);
    const nextRef = `VTE-${String(lastNum + 1).padStart(4, '0')}`;
    const newRecord: SaleRecord = {
      ...saleData,
      id: `sale-rec-${Date.now()}`,
      reference: nextRef,
      createdAt: new Date().toISOString(),
    };

    const soldPurchaseIds = saleData.purchaseIds ?? [];
    const soldPurchaseSet = new Set(soldPurchaseIds);
    const updatedPurchases = soldPurchaseIds.length > 0
      ? purchases.map((purchase) => {
          if (!soldPurchaseSet.has(purchase.id)) return purchase;
          const marked: PurchaseRecord = {
            ...purchase,
            soldAt: newRecord.createdAt,
            saleReference: nextRef,
          };
          FirebaseSyncService.savePurchase(marked);
          return marked;
        })
      : purchases;
    if (soldPurchaseIds.length > 0) {
      setPurchases(updatedPurchases);
    }

    // 1. Déduction du stock d'or :
    // Si des achats précis sont liés à la vente, sortir leur poids exact par carat et catégorie.
    // Et si tous les achats sont désormais vendus, solder automatiquement les éventuels écarts
    // (pertes de fonte, anciens mouvements) pour remettre le stock physique à 0 dès la vente.
    const matchedSoldPurchases = soldPurchaseIds.length > 0
      ? purchases.filter((purchase) => soldPurchaseSet.has(purchase.id) && !purchase.cancelledAt)
      : [];

    const saleMovements: GoldStockMovement[] = [];
    const deductionNow = Date.now();
    const deductionIso = new Date(deductionNow).toISOString();

    if (matchedSoldPurchases.length > 0) {
      let deductedFineGrams = 0;
      matchedSoldPurchases.forEach((purchase, idx) => {
        const netWeight =
          purchase.netWeightGrams ??
          Math.max(0, (purchase.grossWeightGrams || 0) - (purchase.nonGoldWeightGrams || 0));
        const karatVal = purchase.karat ? goldKaratValue(purchase.karat) : null;
        if (netWeight > 0 && purchase.karat) {
          if (karatVal) {
            deductedFineGrams += (netWeight * karatVal) / 24;
          }
          saleMovements.push({
            id: `mov-${deductionNow}-${idx}`,
            label: `Vente ${nextRef} · ${newRecord.clientName}`,
            karat: purchase.karat,
            weightGrams: -netWeight,
            date: deductionIso,
            type: 'Vente',
            category: purchase.goldCategory || 'Or brut',
            reason: `Sortie complète du lot ${purchase.reference || purchase.id} sur vente ${nextRef}`,
            referenceId: nextRef,
          });
        }
      });

      const extraFineToDeduct = newRecord.totalPureWeight24kGrams - deductedFineGrams;
      if (extraFineToDeduct > 0.05) {
        saleMovements.push({
          id: `mov-${deductionNow}-extra`,
          label: `Vente ${nextRef} · Complément or pur`,
          karat: '24K',
          weightGrams: -parseFloat(extraFineToDeduct.toFixed(3)),
          date: deductionIso,
          type: 'Vente',
          category: 'Or fondu',
          reason: `Complément de sortie sur vente ${nextRef}`,
          referenceId: nextRef,
        });
      }
    } else if (newRecord.totalPureWeight24kGrams > 0) {
      const deductionGrams = newRecord.totalPureWeight24kGrams;
      saleMovements.push({
        id: `mov-${deductionNow}`,
        label: `Vente ${nextRef} · ${newRecord.clientName}`,
        karat: '24K',
        weightGrams: -deductionGrams,
        date: deductionIso,
        type: 'Vente',
        category: 'Or fondu',
        reason: `Sortie de stock vente ${nextRef} (${newRecord.totalPureOunces.toFixed(2)} oz pur / ${newRecord.totalGeneralWeightGrams.toFixed(1)} g brut)`,
        referenceId: nextRef,
      });
    }

    const nextSaleRecords = [newRecord, ...saleRecords];
    const nextMovementsWithSale = [...saleMovements, ...stockMovements];
    const remainingUnsoldPurchases = getUnsoldPurchases(
      updatedPurchases,
      nextSaleRecords,
      nextMovementsWithSale
    );
    const zeroOutCorrections =
      remainingUnsoldPurchases.length === 0
        ? buildGoldStockReconciliationMovements(
            nextMovementsWithSale,
            updatedPurchases,
            nextSaleRecords,
            nextRef
          )
        : [];
    const allNewStockMovements = [...zeroOutCorrections, ...saleMovements];

    if (allNewStockMovements.length > 0) {
      allNewStockMovements.forEach((movement) => FirebaseSyncService.saveStockMovement(movement));
      setStockMovements([...allNewStockMovements, ...stockMovements]);
    }

    // 2. Les encaissements et acomptes issus des ventes d'or vont directement dans Devise d'or.
    const now = new Date().toISOString();
    const updatedGoldCurrencyBalances = { ...goldCurrencyBalances };
    const goldCurMovements: CurrencyStockMovement[] = [];

    for (const adv of newRecord.advances) {
      const currency = adv.currency || 'USD';
      const amount = currency === 'AED' ? adv.amountAed ?? 0 : adv.amountUsd;
      if (amount <= 0 || !Number.isFinite(amount)) continue;

      const usdToXafRate = newRecord.usdToXafRate ?? 0;
      const currencyRate = currency === 'AED'
        ? usdToXafRate / (newRecord.usdToAedRate || 3.6725)
        : usdToXafRate;
      updatedGoldCurrencyBalances[currency] = (updatedGoldCurrencyBalances[currency] ?? 0) + amount;
      goldCurMovements.push({
        id: `cur-sale-${nextRef}-${Date.now()}-${goldCurMovements.length}`,
        currency,
        amount,
        type: 'Encaissement vente or',
        label: `${adv.label} · Vente ${nextRef} · ${newRecord.clientName}`,
        date: now,
        rate: currencyRate,
        totalXaf: Math.round(amount * currencyRate),
        account: 'Devise d’or',
        contact: newRecord.clientName,
        referenceId: nextRef,
      });
    }

    if (goldCurMovements.length > 0) {
      setGoldCurrencyBalances(updatedGoldCurrencyBalances);
      setGoldCurrencyMovements([...goldCurMovements, ...goldCurrencyMovements]);
    }

    // Résumé rétro-compatible
    const summary = `${newRecord.clientName} · ${newRecord.totalGeneralWeightGrams.toFixed(1)} g brut (${newRecord.totalPureOunces.toFixed(2)} oz pur 24K) · Brut $${newRecord.grossRevenueUsd.toFixed(2)}`;
    setSales([summary, ...sales]);

    const updatedSaleRecords = [newRecord, ...saleRecords];
    setSaleRecords(updatedSaleRecords);
    FirebaseSyncService.saveFullSaleRecord(newRecord);
    return newRecord;
  };

  const updateSaleRecordBars = (saleId: string, bars: SaleBarItem[]): SaleRecord => {
    const sale = saleRecords.find((record) => record.id === saleId);
    if (!sale) throw new Error('Bordereau introuvable.');
    if (bars.length === 0 || bars.some((bar) =>
      !Number.isFinite(bar.barWeight) ||
      bar.barWeight <= 0 ||
      !Number.isFinite(bar.sampleWeight) ||
      bar.sampleWeight < 0 ||
      !Number.isFinite(bar.goldPurity) ||
      bar.goldPurity <= 0 ||
      bar.goldPurity > 1
    )) {
      throw new Error('Chaque ligne doit avoir un poids positif, un échantillon valide et une pureté entre 0 et 1.');
    }

    const totalGeneralWeightGrams = bars.reduce((sum, bar) => sum + bar.barWeight, 0);
    const totalSampleWeightGrams = bars.reduce((sum, bar) => sum + bar.sampleWeight, 0);
    const totalPureWeight24kGrams = bars.reduce((sum, bar) => {
      const barCarat = bar.carat > 0 ? bar.carat : bar.goldPurity * 24;
      return sum + parseFloat((((bar.barWeight + bar.sampleWeight) / 24) * barCarat).toFixed(3));
    }, 0);
    const totalPureOunces = totalPureWeight24kGrams / TROY_OUNCE_IN_GRAMS;
    const totalAssayedWeight = totalGeneralWeightGrams + totalSampleWeightGrams;
    const averagePurity = totalAssayedWeight > 0
      ? totalPureWeight24kGrams / totalAssayedWeight
      : 0;
    const averageCarat = parseFloat((averagePurity * 24).toFixed(2));
    const grossRevenueUsd = sale.fixings?.length
      ? parseFloat(sale.fixings.reduce(
          (total, fixing) => total + fixing.ounces * fixing.pricePerOunceUsd,
          0
        ).toFixed(2))
      : parseFloat((totalPureOunces * sale.fixingPricePerOunceUsd).toFixed(2));
    const usdToAedRate = sale.usdToAedRate || 3.6725;
    const usdToXafRate = sale.usdToXafRate || 0;
    const totalWithdrawUsd = parseFloat(
      (sale.totalChargesUsd + sale.totalAdvancesUsd).toFixed(2)
    );
    if (grossRevenueUsd + 0.01 < totalWithdrawUsd) {
      throw new Error('Le nouveau montant de vente ne peut pas être inférieur aux frais et acomptes déjà enregistrés.');
    }
    const balanceRemainingUsd = Math.max(
      0,
      parseFloat((grossRevenueUsd - totalWithdrawUsd).toFixed(2))
    );
    const updatedSale: SaleRecord = {
      ...sale,
      bars,
      totalGeneralWeightGrams,
      totalSampleWeightGrams,
      averagePurity,
      averageCarat,
      totalPureWeight24kGrams,
      totalPureOunces,
      grossRevenueUsd,
      grossRevenueAed: parseFloat((grossRevenueUsd * usdToAedRate).toFixed(2)),
      grossRevenueXaf: Math.round(grossRevenueUsd * usdToXafRate),
      totalWithdrawUsd,
      totalWithdrawAed: parseFloat((totalWithdrawUsd * usdToAedRate).toFixed(2)),
      totalWithdrawXaf: Math.round(totalWithdrawUsd * usdToXafRate),
      balanceRemainingUsd,
      balanceRemainingAed: parseFloat((balanceRemainingUsd * usdToAedRate).toFixed(2)),
      balanceRemainingXaf: Math.round(balanceRemainingUsd * usdToXafRate),
      status: sale.status === 'pending' && sale.fixingPricePerOunceUsd <= 0
        ? 'pending'
        : balanceRemainingUsd <= 0.01
          ? 'settled'
          : 'partially_paid',
    };

    const stockAdjustmentGrams = sale.totalPureWeight24kGrams - totalPureWeight24kGrams;
    if (Math.abs(stockAdjustmentGrams) > 0.0005) {
      const movement: GoldStockMovement = {
        id: `mov-sale-edit-${sale.id}-${Date.now()}`,
        label: `Correction vente ${sale.reference} · ${sale.clientName}`,
        karat: '24K',
        weightGrams: stockAdjustmentGrams,
        date: new Date().toISOString(),
        type: 'Correction',
        category: 'Or fondu',
        reason: `Correction du bordereau ${sale.reference}`,
        referenceId: sale.reference,
      };
      setStockMovements([movement, ...stockMovements]);
      FirebaseSyncService.saveStockMovement(movement);
    }

    setSaleRecords(saleRecords.map((record) =>
      record.id === saleId ? updatedSale : record
    ));
    FirebaseSyncService.saveFullSaleRecord(updatedSale);
    return updatedSale;
  };

  const updateSaleFixings = (saleId: string, fixings: SaleFixingItem[]): SaleRecord => {
    const sale = saleRecords.find((record) => record.id === saleId);
    if (!sale) throw new Error('Bordereau introuvable.');
    if (fixings.length === 0 || fixings.some((fixing) =>
      !fixing.date.trim() ||
      !Number.isFinite(fixing.quantityGrams) ||
      fixing.quantityGrams < 0 ||
      !Number.isFinite(fixing.ounces) ||
      fixing.ounces < 0 ||
      !Number.isFinite(fixing.pricePerOunceUsd) ||
      fixing.pricePerOunceUsd <= 0
    )) {
      throw new Error('Chaque fixing doit avoir une date, des quantités valides et un prix par once supérieur à zéro.');
    }

    const grossRevenueUsd = parseFloat(fixings.reduce(
      (total, fixing) => total + fixing.ounces * fixing.pricePerOunceUsd,
      0
    ).toFixed(2));
    const totalWithdrawUsd = parseFloat(
      (sale.totalChargesUsd + sale.totalAdvancesUsd).toFixed(2)
    );
    if (grossRevenueUsd + 0.01 < totalWithdrawUsd) {
      throw new Error('Le montant de vente ne peut pas être inférieur aux frais et acomptes déjà enregistrés.');
    }

    const usdToAedRate = sale.usdToAedRate || 3.6725;
    const usdToXafRate = sale.usdToXafRate || 0;
    const totalFixingOunces = fixings.reduce((total, fixing) => total + fixing.ounces, 0);
    const fixingPricePerOunceUsd = totalFixingOunces > 0
      ? grossRevenueUsd / totalFixingOunces
      : fixings[0].pricePerOunceUsd;
    const balanceRemainingUsd = Math.max(
      0,
      parseFloat((grossRevenueUsd - totalWithdrawUsd).toFixed(2))
    );
    const updatedSale: SaleRecord = {
      ...sale,
      fixings,
      fixingDate: fixings[0].date,
      fixingPricePerOunceUsd,
      grossRevenueUsd,
      grossRevenueAed: parseFloat((grossRevenueUsd * usdToAedRate).toFixed(2)),
      grossRevenueXaf: Math.round(grossRevenueUsd * usdToXafRate),
      totalWithdrawUsd,
      totalWithdrawAed: parseFloat((totalWithdrawUsd * usdToAedRate).toFixed(2)),
      totalWithdrawXaf: Math.round(totalWithdrawUsd * usdToXafRate),
      balanceRemainingUsd,
      balanceRemainingAed: parseFloat((balanceRemainingUsd * usdToAedRate).toFixed(2)),
      balanceRemainingXaf: Math.round(balanceRemainingUsd * usdToXafRate),
      status: balanceRemainingUsd <= 0.01 ? 'settled' : 'partially_paid',
    };

    setSaleRecords(saleRecords.map((record) =>
      record.id === saleId ? updatedSale : record
    ));
    FirebaseSyncService.saveFullSaleRecord(updatedSale);
    return updatedSale;
  };

  const updateSalePurchaseCost = (saleId: string, purchaseCostXaf?: number): SaleRecord => {
    const sale = saleRecords.find((record) => record.id === saleId);
    if (!sale) throw new Error('Bordereau introuvable.');
    if (purchaseCostXaf !== undefined && (!Number.isFinite(purchaseCostXaf) || purchaseCostXaf < 0)) {
      throw new Error('Le coût d’achat doit être supérieur ou égal à zéro.');
    }

    const updatedSaleBase: SaleRecord = {
      ...sale,
      purchaseCostXaf: purchaseCostXaf !== undefined ? Math.round(purchaseCostXaf) : undefined,
    };
    const breakdown = computeSaleProfitBreakdown({
      sale: updatedSaleBase,
      purchases,
      fallbackUsdToXafRate,
      averageCostPerFineGramXaf: averagePurchaseCostPerFineGramXaf,
    });
    const updatedSale: SaleRecord = {
      ...updatedSaleBase,
      netProfitXaf: breakdown.netProfitXaf,
    };

    setSaleRecords(saleRecords.map((record) =>
      record.id === saleId ? updatedSale : record
    ));
    FirebaseSyncService.saveFullSaleRecord(updatedSale);
    return updatedSale;
  };

  const addSaleAdvance = (
    saleId: string,
    advanceData: Omit<SaleAdvancePayment, 'id'>,
    clientDetails?: Pick<
      SaleRecord,
      | 'clientName'
      | 'clientReference'
      | 'clientPhone'
      | 'clientCity'
      | 'clientEmail'
      | 'clientBankName'
      | 'clientBankAccountNumber'
    >
  ) => {
    const sale = saleRecords.find((s) => s.id === saleId);
    if (!sale) throw new Error('Vente introuvable.');
    const saleUsdToXafRate = sale.usdToXafRate ?? 0;
    if (saleUsdToXafRate <= 0) {
      throw new Error('Un taux USD/XAF réel est nécessaire pour calculer le montant en FCFA.');
    }

    const newAdvId = `adv-${Date.now()}`;
    const currency = advanceData.currency || 'USD';
    const amount = currency === 'AED' ? advanceData.amountAed ?? 0 : advanceData.amountUsd;
    if (amount <= 0 || !Number.isFinite(amount)) {
      throw new Error('Le montant reçu doit être supérieur à zéro.');
    }
    if (!Number.isFinite(advanceData.amountUsd) || advanceData.amountUsd <= 0) {
      throw new Error('Le montant équivalent en USD doit être supérieur à zéro.');
    }
    if (advanceData.amountUsd > sale.balanceRemainingUsd + 0.01) {
      throw new Error('Le montant de l’acompte ne peut pas dépasser le solde restant dû.');
    }
    const currencyRate = currency === 'AED'
      ? saleUsdToXafRate / (sale.usdToAedRate || 3.6725)
      : saleUsdToXafRate;
    const xafAmount = Math.round(amount * currencyRate);

    const newAdvance: SaleAdvancePayment = {
      ...advanceData,
      id: newAdvId,
      amountXaf: xafAmount,
      amountAed: advanceData.amountAed || parseFloat((advanceData.amountUsd * (sale.usdToAedRate || 3.6725)).toFixed(2)),
    };

    const newAdvancesList = [...sale.advances, newAdvance];
    const newTotalAdvancesUsd = newAdvancesList.reduce((sum, a) => sum + a.amountUsd, 0);
    const newTotalWithdrawUsd = parseFloat((sale.totalChargesUsd + newTotalAdvancesUsd).toFixed(2));
    const newBalanceUsd = Math.max(0, parseFloat((sale.grossRevenueUsd - newTotalWithdrawUsd).toFixed(2)));
    const aedRate = sale.usdToAedRate || 3.6725;
    const xafRate = saleUsdToXafRate;

    const updatedSale: SaleRecord = {
      ...sale,
      ...clientDetails,
      advances: newAdvancesList,
      totalAdvancesUsd: newTotalAdvancesUsd,
      totalWithdrawUsd: newTotalWithdrawUsd,
      totalWithdrawAed: parseFloat((newTotalWithdrawUsd * aedRate).toFixed(2)),
      balanceRemainingUsd: newBalanceUsd,
      balanceRemainingAed: parseFloat((newBalanceUsd * aedRate).toFixed(2)),
      balanceRemainingXaf: Math.round(newBalanceUsd * xafRate),
      status: newBalanceUsd <= 0.01 ? 'settled' : 'partially_paid',
    };

    const currencyMovement: CurrencyStockMovement = {
      id: `cur-sale-advance-${Date.now()}`,
      currency,
      amount,
      type: 'Encaissement vente or',
      label: `${advanceData.label} · Vente ${sale.reference} · ${sale.clientName}`,
      date: new Date().toISOString(),
      rate: currencyRate,
      totalXaf: Math.round(amount * currencyRate),
      account: 'Devise d’or',
      contact: sale.clientName,
      referenceId: sale.reference,
    };
    setGoldCurrencyBalances({
      ...goldCurrencyBalances,
      [currency]: (goldCurrencyBalances[currency] ?? 0) + amount,
    });
    setGoldCurrencyMovements([currencyMovement, ...goldCurrencyMovements]);

    setSaleRecords(saleRecords.map((s) => (s.id === saleId ? updatedSale : s)));
    FirebaseSyncService.saveFullSaleRecord(updatedSale);
    return updatedSale;
  };

  const addExchange = ({
    description,
    receivedCurrency,
    receivedAmount,
    deliveredCurrency,
    deliveredAmount,
  }: {
    description: string;
    receivedCurrency?: string;
    receivedAmount?: number;
    deliveredCurrency?: string;
    deliveredAmount?: number;
  }) => {
    if (receivedCurrency && deliveredCurrency && receivedAmount && deliveredAmount) {
      if (receivedCurrency === deliveredCurrency) {
        throw new Error('Les devises reçues et remises doivent être différentes.');
      }
      const available = currencyBalances[deliveredCurrency] ?? 0;

      const now = new Date().toISOString();
      setCurrencyBalances({
        ...currencyBalances,
        [receivedCurrency]: (currencyBalances[receivedCurrency] ?? 0) + receivedAmount,
        [deliveredCurrency]: available - deliveredAmount,
      });

      const movements: CurrencyStockMovement[] = [
        {
          id: `cur-mov-${Date.now()}-1`,
          currency: receivedCurrency,
          amount: receivedAmount,
          type: 'Change reçu',
          label: description,
          date: now,
        },
        {
          id: `cur-mov-${Date.now()}-2`,
          currency: deliveredCurrency,
          amount: -deliveredAmount,
          type: 'Change remis',
          label: description,
          date: now,
        },
      ];
      setCurrencyStockMovements([...movements, ...currencyStockMovements]);
    }

    setExchanges([description, ...exchanges]);

    const newOp: LedgerEntry = {
      id: `op-${Date.now()}`,
      title: 'Nouvel échange',
      subtitle: description,
      amount: 0,
      date: 'Aujourd’hui',
      isIncome: true,
      isProcessed: true,
    };
    setOperations([newOp, ...operations]);
  };

  const adjustCurrencyStock = ({
    currency,
    amount,
    isAddition,
    reason,
    movementType,
  }: {
    currency: string;
    amount: number;
    isAddition: boolean;
    reason: string;
    movementType?: string;
  }) => {
    if (!currency.trim()) throw new Error('Sélectionnez une devise.');
    if (amount <= 0 || !Number.isFinite(amount)) throw new Error('Le montant doit être supérieur à zéro.');
    if (!reason.trim()) throw new Error('Le motif est obligatoire.');

    const current = currencyBalances[currency] ?? 0;
    const delta = isAddition ? amount : -amount;

    setCurrencyBalances({
      ...currencyBalances,
      [currency]: current + delta,
    });

    const newMov: CurrencyStockMovement = {
      id: `cur-adj-${Date.now()}`,
      currency,
      amount: delta,
      type: movementType || (isAddition ? 'Ajout solde physique' : 'Ajustement'),
      label: reason.trim(),
      date: new Date().toISOString(),
      account: 'Coffre physique',
    };
    setCurrencyStockMovements([newMov, ...currencyStockMovements]);
  };

  const transferGoldCurrencyToPhysical = ({
    currency,
    amount,
    reason,
  }: {
    currency: string;
    amount: number;
    reason?: string;
  }) => {
    if (!currency.trim()) throw new Error('Sélectionnez une devise.');
    if (amount <= 0 || !Number.isFinite(amount)) {
      throw new Error('Le montant à transférer doit être supérieur à zéro.');
    }

    const now = new Date().toISOString();
    const label = reason?.trim() || `Transfert Devise d’or → Solde physique (${currency})`;

    setGoldCurrencyBalances((prev) => ({
      ...prev,
      [currency]: parseFloat(((prev[currency] ?? 0) - amount).toFixed(4)),
    }));
    setGoldCurrencyMovements((prev) => [
      {
        id: `gcur-trf-${Date.now()}`,
        currency,
        amount: -amount,
        type: 'Transfert vers solde physique',
        label,
        date: now,
        account: 'Coffre physique',
      },
      ...prev,
    ]);

    setCurrencyBalances((prev) => ({
      ...prev,
      [currency]: parseFloat(((prev[currency] ?? 0) + amount).toFixed(4)),
    }));
    setCurrencyStockMovements((prev) => [
      {
        id: `cur-trf-in-${Date.now()}`,
        currency,
        amount,
        type: 'Approvisionnement depuis Devise d’or',
        label,
        date: now,
        account: 'Devise d’or',
      },
      ...prev,
    ]);
  };

  const buyCurrency = ({
    currency,
    amount,
    rate,
    totalXaf,
    paymentAccount = 'Caisse (espèces)',
    contactName,
    notes,
  }: {
    currency: string;
    amount: number;
    rate: number;
    totalXaf: number;
    paymentAccount?: string;
    contactName?: string;
    notes?: string;
  }) => {
    if (!currency) throw new Error('Veuillez sélectionner la devise à acheter.');
    if (amount <= 0 || !Number.isFinite(amount)) throw new Error('Le montant de devises doit être supérieur à zéro.');
    if (rate <= 0 || !Number.isFinite(rate)) throw new Error('Le cours d’achat doit être supérieur à zéro.');

    const calculatedTotalXaf = totalXaf > 0 ? totalXaf : Math.round(amount * rate);
    const payAccountKey = paymentAccount || 'Caisse (espèces)';
    const accountBalance = bankBalances[payAccountKey] ?? 0;

    // 1. Augmentation du stock de devises
    const currentCurBal = currencyBalances[currency] ?? 0;
    const updatedCurBalances = {
      ...currencyBalances,
      [currency]: currentCurBal + amount,
    };
    setCurrencyBalances(updatedCurBalances);

    // 2. Décaissement FCFA depuis Caisse ou Banque
    const updatedBankBalances = {
      ...bankBalances,
      [payAccountKey]: accountBalance - calculatedTotalXaf,
    };
    setBankBalances(updatedBankBalances);
    FirebaseSyncService.saveBankBalances(updatedBankBalances);

    // 3. Mouvement de stock de devises
    const now = new Date().toISOString();
    const clientLabel = contactName?.trim() || 'Client comptoir';
    const movDescription = `Achat de ${amount.toLocaleString('fr-FR')} ${currency} @ ${rate.toLocaleString('fr-FR')} FCFA · ${clientLabel}`;

    const newCurMovement: CurrencyStockMovement = {
      id: `cur-buy-${Date.now()}`,
      currency,
      amount,
      type: 'Achat devise',
      label: movDescription,
      date: now,
      rate,
      totalXaf: calculatedTotalXaf,
      account: payAccountKey,
      contact: clientLabel,
    };
    setCurrencyStockMovements([newCurMovement, ...currencyStockMovements]);

    // 4. Écriture comptable dans le journal (Sortie de caisse pour achat de devise)
    const newOp: LedgerEntry = {
      id: `op-curbuy-${Date.now()}`,
      title: `Achat devise · +${amount.toLocaleString('fr-FR')} ${currency}`,
      subtitle: `${calculatedTotalXaf.toLocaleString('fr-FR')} FCFA décaissés de ${payAccountKey} (@ ${rate} FCFA) · ${clientLabel}${notes ? ' · ' + notes : ''}`,
      amount: calculatedTotalXaf,
      date: 'Aujourd’hui',
      createdAt: now,
      isIncome: false,
      isProcessed: true,
    };
    setOperations([newOp, ...operations]);
  };

  const sellCurrency = ({
    currency,
    amount,
    rate,
    totalXaf,
    receiptAccount = 'Caisse (espèces)',
    contactName,
    notes,
  }: {
    currency: string;
    amount: number;
    rate: number;
    totalXaf: number;
    receiptAccount?: string;
    contactName?: string;
    notes?: string;
  }) => {
    if (!currency) throw new Error('Veuillez sélectionner la devise à vendre.');
    if (amount <= 0 || !Number.isFinite(amount)) throw new Error('Le montant de devises doit être supérieur à zéro.');
    if (rate <= 0 || !Number.isFinite(rate)) throw new Error('Le cours de vente doit être supérieur à zéro.');

    const currentCurBal = currencyBalances[currency] ?? 0;

    const calculatedTotalXaf = totalXaf > 0 ? totalXaf : Math.round(amount * rate);
    const recAccountKey = receiptAccount || 'Caisse (espèces)';
    const accountBalance = bankBalances[recAccountKey] ?? 0;

    // 1. Réduction du stock de devises
    const updatedCurBalances = {
      ...currencyBalances,
      [currency]: currentCurBal - amount,
    };
    setCurrencyBalances(updatedCurBalances);

    // 2. Encaissement FCFA en Caisse ou Banque
    const updatedBankBalances = {
      ...bankBalances,
      [recAccountKey]: accountBalance + calculatedTotalXaf,
    };
    setBankBalances(updatedBankBalances);
    FirebaseSyncService.saveBankBalances(updatedBankBalances);

    // 3. Mouvement de stock de devises
    const now = new Date().toISOString();
    const clientLabel = contactName?.trim() || 'Client comptoir';
    const movDescription = `Vente de ${amount.toLocaleString('fr-FR')} ${currency} @ ${rate.toLocaleString('fr-FR')} FCFA · ${clientLabel}`;

    const newCurMovement: CurrencyStockMovement = {
      id: `cur-sell-${Date.now()}`,
      currency,
      amount: -amount,
      type: 'Vente devise',
      label: movDescription,
      date: now,
      rate,
      totalXaf: calculatedTotalXaf,
      account: recAccountKey,
      contact: clientLabel,
    };
    setCurrencyStockMovements([newCurMovement, ...currencyStockMovements]);

    // 4. Écriture comptable dans le journal (Entrée de caisse pour vente de devise)
    const newOp: LedgerEntry = {
      id: `op-cursell-${Date.now()}`,
      title: `Vente devise · -${amount.toLocaleString('fr-FR')} ${currency}`,
      subtitle: `${calculatedTotalXaf.toLocaleString('fr-FR')} FCFA encaissés en ${recAccountKey} (@ ${rate} FCFA) · ${clientLabel}${notes ? ' · ' + notes : ''}`,
      amount: calculatedTotalXaf,
      date: 'Aujourd’hui',
      createdAt: now,
      isIncome: true,
      isDeposit: recAccountKey.toLowerCase().includes('caisse'),
      isProcessed: true,
    };
    setOperations([newOp, ...operations]);
  };

  const addPartner = (partnerData: Omit<Partner, 'id' | 'createdAt'>) => {
    const newPartner: Partner = {
      ...partnerData,
      id: `part-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    setPartners([...partners, newPartner]);
  };

  const addPartnership = (partnershipData: Omit<Partnership, 'id' | 'reference' | 'createdAt'>) => {
    const year = new Date().getFullYear();
    const count = partnerships.filter((p) => p.reference?.startsWith(`PAR-${year}-`)).length;
    const reference = `PAR-${year}-${String(count + 1).padStart(4, '0')}`;
    const newPartnership: Partnership = {
      ...partnershipData,
      id: `ptn-${Date.now()}`,
      reference,
      createdAt: new Date().toISOString(),
    };
    setPartnerships([newPartnership, ...partnerships]);
  };

  const updatePartnershipStatus = (id: string, status: PartnershipStatus) => {
    setPartnerships(
      partnerships.map((p) => (p.id === id ? { ...p, status } : p))
    );
  };

  const addPartnershipCashMovement = (
    movementData: Omit<PartnershipCashMovement, 'id' | 'createdAt' | 'createdBy'>
  ) => {
    if (!movementData.partnerId) {
      throw new Error('Sélectionnez le partenaire concerné pour cette opération de caisse.');
    }
    const targetPartner = partners.find((p) => p.id === movementData.partnerId);

    if (!Number.isFinite(movementData.amountXaf) || movementData.amountXaf <= 0) {
      throw new Error('Le montant du mouvement doit être supérieur à zéro.');
    }
    if (
      movementData.type !== 'contribution' &&
      (!Number.isFinite(movementData.weightGrams) ||
        (movementData.weightGrams ?? 0) <= 0 ||
        !Number.isFinite(movementData.karat) ||
        (movementData.karat ?? 0) < 1 ||
        (movementData.karat ?? 0) > 24)
    ) {
      throw new Error('Le poids doit être positif et le carat compris entre 1 et 24.');
    }

    const movement: PartnershipCashMovement = {
      ...movementData,
      partnerName: movementData.partnerName || targetPartner?.name,
      id: `part-cash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      createdBy: userName,
    };
    setPartnershipCashMovements((previous) => [movement, ...previous]);
  };

  const addLoan = (loanData: Omit<PartnershipLoan, 'id' | 'reference' | 'createdAt' | 'repayments'>) => {
    const year = new Date().getFullYear();
    const count = loans.filter((l) => l.reference?.startsWith(`PRET-${year}-`)).length;
    const reference = `PRET-${year}-${String(count + 1).padStart(4, '0')}`;
    const newLoan: PartnershipLoan = {
      ...loanData,
      id: `loan-${Date.now()}`,
      reference,
      createdAt: new Date().toISOString(),
      repayments: [],
    };
    setLoans([newLoan, ...loans]);
  };

  const addLoanRepayment = (loanId: string, repaymentData: Omit<PartnershipRepayment, 'paidAt'>) => {
    const targetLoan = loans.find((l) => l.id === loanId);
    if (!targetLoan) throw new Error('Prêt introuvable.');
    const alreadyRepaid = targetLoan.repayments.reduce((sum, r) => sum + r.amountXaf, 0);
    const remaining = targetLoan.principalXaf - alreadyRepaid;
    if (repaymentData.amountXaf <= 0 || repaymentData.amountXaf > remaining) {
      throw new Error('Montant de remboursement invalide.');
    }

    const newRepayment: PartnershipRepayment = {
      ...repaymentData,
      id: `rep-${Date.now()}`,
      paidAt: new Date().toISOString(),
    };

    setLoans(
      loans.map((l) =>
        l.id === loanId ? { ...l, repayments: [...l.repayments, newRepayment] } : l
      )
    );
  };

  const resetToDefaults = () => {
    setUserName('');
    setContacts([]);
    setBankBalances(EMPTY_BANK_BALANCES);
    setOperations([]);
    setPurchases([]);
    setStockMovements([]);
    setCurrencyBalances(EMPTY_CURRENCY_BALANCES);
    setCurrencyStockMovements([]);
    setGoldCurrencyBalances(EMPTY_GOLD_CURRENCY_BALANCES);
    setGoldCurrencyMovements([]);
    setExchanges([]);
    setSales([]);
    setSaleRecords([]);
    setPartners([]);
    setPartnerships([]);
    setPartnershipCashMovements([]);
    setLoans([]);
    setPurchaseFormulaConfig(DEFAULT_PURCHASE_FORMULA_CONFIG);
    setUsers([]);
    setTasks([]);
    setCurrentUserIdState('');
  };

  const updatePurchaseFormulaConfig = (updates: Partial<PurchaseFormulaConfig>) => {
    setPurchaseFormulaConfig((prev) => {
      const next = { ...prev, ...updates };
      FirebaseSyncService.saveFormulaConfig(next);
      return next;
    });
  };

  const resetPurchaseFormulaConfig = () => {
    setPurchaseFormulaConfig(DEFAULT_PURCHASE_FORMULA_CONFIG);
    FirebaseSyncService.saveFormulaConfig(DEFAULT_PURCHASE_FORMULA_CONFIG);
  };

  // Module Utilisateurs, Rôles & Tâches (Gestion des Droits d'Accès aux Interfaces & Services)
  const updateUserPermissions = (
    userId: string,
    allowedModules: number[],
    allowedServices?: string[]
  ) => {
    const resolvedServices = allowedServices ?? getDefaultAllowedServices(allowedModules);
    const derivedModules = Array.from(
      new Set(
        allowedServices
          ? APP_MODULES_LIST.filter((mod) =>
              mod.services.some((svc) => resolvedServices.includes(svc.id))
            ).map((mod) => mod.id)
          : allowedModules
      )
    );

    const targetUser = users.find((u) => u.id === userId);
    setUsers((prev) =>
      prev.map((u) =>
        u.id === userId
          ? { ...u, allowedModules: derivedModules, allowedServices: resolvedServices }
          : u
      )
    );

    const isCurrentActiveUser =
      userId === currentUserId ||
      (targetUser?.email && authEmail && targetUser.email.toLowerCase() === authEmail.toLowerCase());
    if (isCurrentActiveUser) {
      setProfileAllowedModules(derivedModules);
      setProfileAllowedServices(resolvedServices);
    }

    if (currentRole === 'ADMIN' && userId && !userId.startsWith('usr-')) {
      void setDoc(
        doc(db, 'users', userId),
        {
          allowedModules: derivedModules,
          allowedServices: resolvedServices,
        },
        { merge: true }
      ).catch((error) => {
        console.warn('Firestore updateUserPermissions fallback to local:', error);
      });
    }
  };

  const getCurrentUserEffectivePermissions = (): {
    modules: number[];
    services: string[] | undefined;
  } => {
    const matchedUser = users.find(
      (u) =>
        (currentUserId && u.id === currentUserId) ||
        (authEmail && u.email && u.email.toLowerCase() === authEmail.toLowerCase())
    );
    const roleDefaults = DEFAULT_ROLE_PERMISSIONS[currentRole] || [0];
    const modules = profileAllowedModules ?? matchedUser?.allowedModules ?? roleDefaults;
    const services = profileAllowedServices ?? matchedUser?.allowedServices;
    return { modules, services };
  };

  const canAccessModule = (moduleId: number): boolean => {
    const { modules, services } = getCurrentUserEffectivePermissions();
    if (services !== undefined) {
      const modServices = getModuleServices(moduleId);
      if (modServices.length > 0) {
        return modServices.some((svc) => services.includes(svc.id)) || modules.includes(moduleId);
      }
    }
    return modules.includes(moduleId);
  };

  const canAccessService = (moduleId: number, serviceId: string): boolean => {
    if (!canAccessModule(moduleId)) return false;
    const { services } = getCurrentUserEffectivePermissions();
    if (services === undefined) return true;
    return services.includes(serviceId);
  };

  const addUser = (userData: Omit<AppUser, 'id' | 'createdAt'>) => {
    const defaultModules = userData.allowedModules || DEFAULT_ROLE_PERMISSIONS[userData.role] || [0];
    const defaultServices = userData.allowedServices || getDefaultAllowedServices(defaultModules);
    const newUser: AppUser = {
      ...userData,
      id: `usr-${Date.now()}`,
      createdAt: new Date().toLocaleDateString('fr-FR'),
      allowedModules: defaultModules,
      allowedServices: defaultServices,
    };
    setUsers((prev) => [newUser, ...prev]);
  };

  const updateUser = (id: string, updates: Partial<AppUser>) => {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...updates } : u)));
  };

  const deleteUser = (id: string) => {
    setUsers((prev) => prev.filter((u) => u.id !== id));
  };

  const addTask = (taskData: Omit<AppTask, 'id' | 'reference' | 'createdAt' | 'status'>) => {
    const year = new Date().getFullYear();
    const count = tasks.length + 1;
    const reference = `TSK-${year}-${String(count).padStart(3, '0')}`;
    const newTask: AppTask = {
      ...taskData,
      id: `tsk-${Date.now()}`,
      reference,
      status: 'todo',
      createdAt: new Date().toLocaleDateString('fr-FR'),
      createdBy: `${userName} (Admin)`,
    };
    setTasks((prev) => [newTask, ...prev]);
  };

  const updateTaskStatus = (taskId: string, status: TaskStatus, note?: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        const now = new Date().toLocaleDateString('fr-FR');
        return {
          ...t,
          status,
          completedAt: status === 'completed' || status === 'validated' ? t.completedAt || now : t.completedAt,
          completedBy: status === 'completed' ? t.completedBy || userName : t.completedBy,
          validatedAt: status === 'validated' ? now : t.validatedAt,
          completionNote: note !== undefined ? note : t.completionNote,
        };
      })
    );
  };

  const deleteTask = (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  };

  return (
    <AppContext.Provider
      value={{
        userName,
        isSignedIn,
        authStatus,
        authEmail,
        authMessage,
        contacts,
        bankBalances,
        operations,
        partnerships,
        partnershipCashMovements,
        partners,
        loans,
        exchanges,
        sales,
        saleRecords,
        purchases,
        stockMovements,
        currencyBalances,
        currencyStockMovements,
        goldCurrencyBalances,
        goldCurrencyMovements,
        totalTreasury,
        totalProfit,
        goldProfit,
        currencyProfit,
        unprocessedOperations,
        contactsWithAppointments,
        purchaseFormulaConfig,
        editOperation,
        depositCash,
        withdrawCash,
        users,
        tasks,
        currentRole,
        currentUserId,
        updateUserPermissions,
        canAccessModule,
        canAccessService,
        addUser,
        updateUser,
        deleteUser,
        addTask,
        updateTaskStatus,
        deleteTask,
        signIn,
        signInWithGoogle,
        register,
        signOut,
        refreshAuthorization,
        resendVerificationEmail,
        addContact,
        updateContact,
        saveAppointment,
        removeAppointment,
        markOperationProcessed,
        addBank,
        deleteBank,
        addMovement,
        transferFunds,
        transferToClient,
        addCashToBankDeposit,
        addExpense,
        addPurchase,
        addPurchases,
        updatePurchase,
        addPurchasePayment,
        cancelPurchase,
        stockWeightForKarat,
        adjustGoldStock,
        reconcileGoldStockWithUnsoldPurchases,
        addSale,
        addSaleRecord,
        updateSaleRecordBars,
        updateSaleFixings,
        updateSalePurchaseCost,
        addSaleAdvance,
        addExchange,
        adjustCurrencyStock,
        transferGoldCurrencyToPhysical,
        buyCurrency,
        sellCurrency,
        addPartner,
        addPartnership,
        addPartnershipCashMovement,
        updatePartnershipStatus,
        addLoan,
        addLoanRepayment,
        updatePurchaseFormulaConfig,
        resetPurchaseFormulaConfig,
        resetToDefaults,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useAppStore = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppStore must be used within an AppProvider');
  }
  return context;
};
