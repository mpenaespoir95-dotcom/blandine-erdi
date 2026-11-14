import React, { useState, useMemo, useEffect } from 'react';
import {
  Wallet,
  ArrowLeftRight,
  Receipt,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Building,
  CheckCircle2,
  AlertCircle,
  Send,
  Printer,
  FileText,
  User,
  Landmark,
  CreditCard,
  X,
  ExternalLink,
  Calendar,
  BarChart3,
  Filter,
  PieChart,
  Layers,
  Search,
  Edit3,
} from 'lucide-react';
import { useAppStore } from '../../context/AppContext';
import { AppPanel, PageHeading, SectionHeading, Modal } from '../common/UIComponents';
import { PurchasesScreen } from '../purchases/PurchasesScreen';
import {
  formatMoney,
  formatDateTime,
  formatNumber,
  parseLedgerDate,
  TreasuryPeriodMode,
  TreasuryPeriodFilter,
  isDateInPeriod,
  MONTH_NAMES_FR,
  QUARTER_NAMES_FR,
  SEMESTER_NAMES_FR,
} from '../../utils/goldMath';
import { LedgerEntry } from '../../types';
import { OfficialBankDepositSlipModal } from '../banks/OfficialBankDepositSlipModal';
import { BankDepositForm } from '../banks/BankDepositForm';

const EXPENSE_CATEGORIES = [
  'Dépense courante',
  'Salaires',
  'Loyer',
  'Eau et Électricité',
  'Marketing',
  'Fournitures de bureau',
  'Assurances',
  'Transport & Logistique',
  'Autres frais administratifs',
] as const;

interface CashScreenProps {
  initialTab?: 'achat' | 'depot_retrait' | 'appro' | 'virement_client' | 'depenses' | 'versements' | 'flux_periodes';
}

export const CashScreen: React.FC<CashScreenProps> = ({ initialTab = 'achat' }) => {
  const store = useAppStore();
  const canNewPurchase = store.canAccessService(1, 'cash.achat_nouvel');
  const canPurchaseList = store.canAccessService(1, 'cash.achat_liste');
  const canAchat = canNewPurchase || canPurchaseList;
  const canDepotRetrait = store.canAccessService(1, 'cash.depot_retrait');
  const canAppro = store.canAccessService(1, 'cash.appro');
  const canDepenses = store.canAccessService(1, 'cash.depenses');
  const canVersements = store.canAccessService(1, 'cash.versements');
  const canFlux = store.canAccessService(1, 'cash.flux_periodes');

  const canCaisse = canDepotRetrait || canDepenses;

  const allowedCashTabs = useMemo(() => {
    const tabs: Array<'achat' | 'depot_retrait' | 'appro' | 'versements' | 'flux_periodes'> = [];
    if (canAchat) tabs.push('achat');
    if (canCaisse) tabs.push('depot_retrait');
    if (canAppro) tabs.push('appro');
    if (canVersements) tabs.push('versements');
    if (canFlux) tabs.push('flux_periodes');
    return tabs;
  }, [canAchat, canCaisse, canAppro, canVersements, canFlux]);

  const normalizedInitial =
    initialTab === 'virement_client'
      ? 'appro'
      : initialTab === 'depenses'
      ? 'depot_retrait'
      : initialTab;
  const [activeTab, setActiveTab] = useState<'achat' | 'depot_retrait' | 'appro' | 'versements' | 'flux_periodes'>(
    allowedCashTabs.includes(normalizedInitial) ? normalizedInitial : (allowedCashTabs[0] || 'achat')
  );
  const [approView, setApproView] = useState<'internal' | 'client'>(
    initialTab === 'virement_client' ? 'client' : 'internal'
  );
  const [isPurchaseFormOpen, setIsPurchaseFormOpen] = useState(false);

  useEffect(() => {
    if (allowedCashTabs.length > 0 && !allowedCashTabs.includes(activeTab)) {
      setActiveTab(allowedCashTabs[0]);
    }
  }, [allowedCashTabs, activeTab]);

  // Compte caisse principal
  const cashAccountName =
    Object.keys(store.bankBalances).find((k) => k.toLowerCase().includes('caisse')) || 'Caisse (espèces)';
  const companyBanks = Object.keys(store.bankBalances).filter((k) => k !== cashAccountName);
  const currentCashBalance = store.bankBalances[cashAccountName] ?? 0;

  // 0. Interface Caisse unifiée (Compte Source, Contact, Montant, Motif, Dépenses OPEX, Dépôt | Retrait)
  const [caisseSourceAccount, setCaisseSourceAccount] = useState<string>(cashAccountName);
  const [caisseContact, setCaisseContact] = useState('');
  const [caisseAmount, setCaisseAmount] = useState('');
  const [caisseMotif, setCaisseMotif] = useState('');
  const [caisseDate, setCaisseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [caisseOpexMode, setCaisseOpexMode] = useState<boolean>(!canDepotRetrait && canDepenses);
  const [caisseOpexCategory, setCaisseOpexCategory] = useState<string>('Dépense courante');
  const [caisseFeedback, setCaisseFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [apercuFilterByContact, setApercuFilterByContact] = useState<boolean>(true);
  const [historyScope, setHistoryScope] = useState<'account' | 'all'>('account');
  const [historyTypeFilter, setHistoryTypeFilter] = useState<'ALL' | 'DEPOT' | 'RETRAIT' | 'OPEX'>('ALL');
  const [isCaisseReportPrintOpen, setIsCaisseReportPrintOpen] = useState(false);

  useEffect(() => {
    if (!Object.prototype.hasOwnProperty.call(store.bankBalances, caisseSourceAccount)) {
      setCaisseSourceAccount(cashAccountName);
    }
  }, [store.bankBalances, caisseSourceAccount, cashAccountName]);

  // Recherche & Modification d'opérations
  const [searchOpQuery, setSearchOpQuery] = useState('');
  const [editingOp, setEditingOp] = useState<LedgerEntry | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSubtitle, setEditSubtitle] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editSuccess, setEditSuccess] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  // 1. Appro (Approvisionnement interne de compte à compte)
  const [approFrom, setApproFrom] = useState('Caisse (espèces)');
  const [approTo, setApproTo] = useState('Caisse (espèces)');
  const [approAmount, setApproAmount] = useState('');
  const [approLabel, setApproLabel] = useState('');
  const [approSuccess, setApproSuccess] = useState<string | null>(null);
  const [approError, setApproError] = useState<string | null>(null);

  // 2. Virement Client (Virement de mon compte vers le compte d'un client)
  const [clientTransferFrom, setClientTransferFrom] = useState('Caisse (espèces)');
  const [selectedContactRef, setSelectedContactRef] = useState<string>('');
  const [customClientName, setCustomClientName] = useState('');
  const [isNewClient, setIsNewClient] = useState(false);
  const [clientBank, setClientBank] = useState('');
  const [clientAccountNumber, setClientAccountNumber] = useState('');
  const [clientBankAgency, setClientBankAgency] = useState('');
  const [clientAccountHolder, setClientAccountHolder] = useState('');
  const [clientBankReference, setClientBankReference] = useState('');
  const [clientTransferAmount, setClientTransferAmount] = useState('');
  const [clientTransferFee, setClientTransferFee] = useState('');
  const [clientTransferReason, setClientTransferReason] = useState('');
  const [clientTransferSuccess, setClientTransferSuccess] = useState<string | null>(null);
  const [clientTransferError, setClientTransferError] = useState<string | null>(null);

  // Modal receipt
  const [receiptEntry, setReceiptEntry] = useState<LedgerEntry | null>(null);

  // 3. Versement en Banque (Versement d'espèces de la Caisse vers un compte bancaire d'entreprise)
  const [versementBank, setVersementBank] = useState<string>(() => companyBanks[0] || 'Ecobank');
  const [versementAmount, setVersementAmount] = useState('');
  const [versementSlip, setVersementSlip] = useState('');
  const [versementDepositor, setVersementDepositor] = useState(store.userName || '');
  const [versementDate, setVersementDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [versementNote, setVersementNote] = useState('');
  const [versementSuccess, setVersementSuccess] = useState<string | null>(null);
  const [versementError, setVersementError] = useState<string | null>(null);
  const [selectedDepositReceipt, setSelectedDepositReceipt] = useState<LedgerEntry | null>(null);

  // 4. Périodes Entrées & Sorties (Mois, Trimestre, Semestre, Annuel)
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const currentQuarter = (Math.floor(currentMonth / 3) + 1) as 1 | 2 | 3 | 4;
  const currentSemester = (currentMonth < 6 ? 1 : 2) as 1 | 2;

  const [periodMode, setPeriodMode] = useState<TreasuryPeriodMode>('month');
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);
  const [selectedQuarter, setSelectedQuarter] = useState<1 | 2 | 3 | 4>(currentQuarter);
  const [selectedSemester, setSelectedSemester] = useState<1 | 2>(currentSemester);
  const [operationsTypeFilter, setOperationsTypeFilter] = useState<'ALL' | 'IN' | 'OUT'>('ALL');

  const periodFilter: TreasuryPeriodFilter = useMemo(
    () => ({
      mode: periodMode,
      year: selectedYear,
      monthIndex: periodMode === 'month' ? selectedMonth : undefined,
      quarterIndex: periodMode === 'quarter' ? selectedQuarter : undefined,
      semesterIndex: periodMode === 'semester' ? selectedSemester : undefined,
    }),
    [periodMode, selectedYear, selectedMonth, selectedQuarter, selectedSemester]
  );

  const periodLabel = useMemo(() => {
    switch (periodMode) {
      case 'month':
        return `${MONTH_NAMES_FR[selectedMonth]} ${selectedYear}`;
      case 'quarter':
        return `${QUARTER_NAMES_FR.find((q) => q.id === selectedQuarter)?.label} ${selectedYear}`;
      case 'semester':
        return `${SEMESTER_NAMES_FR.find((s) => s.id === selectedSemester)?.label} ${selectedYear}`;
      case 'year':
        return `Année ${selectedYear}`;
    }
  }, [periodMode, selectedYear, selectedMonth, selectedQuarter, selectedSemester]);

  // Contacts list
  const clientContacts = store.contacts;

  useEffect(() => {
    if (!store.bankBalances[caisseSourceAccount] && store.bankBalances[caisseSourceAccount] !== 0) {
      setCaisseSourceAccount(cashAccountName);
    }
  }, [store.bankBalances, caisseSourceAccount, cashAccountName]);

  // Handle contact select (Appro Virement Client)
  const handleSelectContact = (contactRef: string) => {
    setSelectedContactRef(contactRef);
    if (!contactRef) {
      setIsNewClient(true);
      return;
    }
    setIsNewClient(false);
    const found = store.contacts.find((c) => c.reference === contactRef);
    if (found) {
      setCustomClientName(found.name);
      if (found.bankName) setClientBank(found.bankName);
      if (found.bankAccountNumber) setClientAccountNumber(found.bankAccountNumber);
    }
  };

  // Exécuter un Dépôt au compte sélectionné
  const handleCaisseDepot = () => {
    setCaisseFeedback(null);
    if (!canDepotRetrait) {
      setCaisseFeedback({ type: 'error', message: 'Vous n’avez pas accès aux dépôts de caisse.' });
      return;
    }
    const amt = parseFloat(caisseAmount.replace(/\s+/g, '').replace(',', '.') || '0');
    if (amt <= 0 || !Number.isFinite(amt)) {
      setCaisseFeedback({ type: 'error', message: 'Veuillez saisir un montant strictement positif.' });
      return;
    }
    const contactLabel = caisseContact.trim() || store.userName || 'Gérant';
    const motifLabel = caisseMotif.trim() || 'Dépôt au compte';
    try {
      store.depositCash({
        account: caisseSourceAccount,
        amount: amt,
        depositorName: contactLabel,
        reason: motifLabel,
        date: caisseDate || new Date().toISOString().slice(0, 10),
      });
      if (caisseOpexMode) setCaisseOpexMode(false);
      setCaisseFeedback({
        type: 'success',
        message: `Dépôt de ${formatMoney(amt)} FCFA crédité sur ${caisseSourceAccount} (${contactLabel}).`,
      });
      setCaisseAmount('');
      setCaisseMotif('');
      setTimeout(() => setCaisseFeedback(null), 4000);
    } catch (err: unknown) {
      setCaisseFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Exécuter un Retrait en cash ou une Dépense OPEX sur le compte sélectionné
  const handleCaisseRetrait = () => {
    setCaisseFeedback(null);
    const amt = parseFloat(caisseAmount.replace(/\s+/g, '').replace(',', '.') || '0');
    if (amt <= 0 || !Number.isFinite(amt)) {
      setCaisseFeedback({ type: 'error', message: 'Veuillez saisir un montant strictement positif.' });
      return;
    }
    const contactLabel = caisseContact.trim();
    const motifLabel = caisseMotif.trim();

    if (caisseOpexMode) {
      if (!canDepenses) {
        setCaisseFeedback({ type: 'error', message: 'Vous n’avez pas accès aux dépenses OPEX.' });
        return;
      }
      if (!motifLabel && caisseOpexCategory === 'Dépense courante') {
        setCaisseFeedback({ type: 'error', message: 'Veuillez saisir un motif pour la dépense OPEX.' });
        return;
      }
      const fullDescription =
        caisseOpexCategory === 'Dépense courante'
          ? motifLabel
          : `${caisseOpexCategory}${motifLabel ? ` - ${motifLabel}` : ''}`;
      try {
        store.addExpense({
          account: caisseSourceAccount,
          amount: amt,
          description: fullDescription,
          date: caisseDate || new Date().toISOString().slice(0, 10),
          contactName: contactLabel || undefined,
        });
        setCaisseFeedback({
          type: 'success',
          message: `Dépense OPEX (${caisseOpexCategory}) de ${formatMoney(amt)} FCFA débitée sur ${caisseSourceAccount}.`,
        });
        setCaisseAmount('');
        setCaisseMotif('');
        setTimeout(() => setCaisseFeedback(null), 4000);
      } catch (err: unknown) {
        setCaisseFeedback({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    if (!canDepotRetrait) {
      setCaisseFeedback({ type: 'error', message: 'Vous n’avez pas accès aux retraits de caisse.' });
      return;
    }
    try {
      store.withdrawCash({
        account: caisseSourceAccount,
        amount: amt,
        beneficiaryName: contactLabel || 'Bénéficiaire',
        reason: motifLabel || 'Retrait en cash',
        date: caisseDate || new Date().toISOString().slice(0, 10),
      });
      setCaisseFeedback({
        type: 'success',
        message: `Retrait de ${formatMoney(amt)} FCFA débité sur ${caisseSourceAccount} (${contactLabel || 'Bénéficiaire'}).`,
      });
      setCaisseAmount('');
      setCaisseMotif('');
      setTimeout(() => setCaisseFeedback(null), 4000);
    } catch (err: unknown) {
      setCaisseFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Ouvrir le modal d'édition d'opération
  const handleOpenEditOp = (op: LedgerEntry) => {
    setEditingOp(op);
    setEditTitle(op.title);
    setEditSubtitle(op.subtitle);
    setEditAmount(String(op.amount));
    setEditDate(op.date);
    setEditNotes(op.notes || '');
    setEditSuccess(null);
    setEditError(null);
  };

  // Enregistrer les modifications d'une opération
  const handleSaveEditOp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOp) return;
    const amt = parseFloat(editAmount.replace(',', '.') || '0');
    if (amt <= 0 || !Number.isFinite(amt)) {
      setEditError('Le montant doit être supérieur à zéro.');
      return;
    }
    try {
      store.editOperation(editingOp.id, {
        title: editTitle.trim(),
        subtitle: editSubtitle.trim(),
        amount: amt,
        date: editDate.trim(),
        notes: editNotes.trim(),
      });
      setEditSuccess('Opération mise à jour avec succès.');
      setTimeout(() => {
        setEditingOp(null);
        setEditSuccess(null);
      }, 1200);
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : String(err));
    }
  };

  // Classifier une opération vis-à-vis d'un compte donné (Dépôt vs Retrait vs OPEX)
  const knownAccountNames = useMemo(() => Object.keys(store.bankBalances), [store.bankBalances]);

  const classifyOperationForAccount = (
    op: LedgerEntry,
    accountName: string
  ): { side: 'DEPOT' | 'RETRAIT'; isOpex: boolean; contact: string; motif: string } | null => {
    const titleLower = op.title.toLowerCase();
    const subLower = op.subtitle.toLowerCase();
    const isOpex = titleLower.startsWith('dépense');
    const contact =
      op.depositor ||
      op.beneficiary ||
      op.clientTransferDetails?.clientName ||
      op.title.replace(/^(Dépôt|Retrait|Virement client|Dépense OPEX|Dépense)\s*·\s*/i, '').trim() ||
      '—';
    const motif = op.notes || op.clientTransferDetails?.reason || op.subtitle;

    // 1. Versement bancaire Caisse -> Banque
    if (op.isTransfer && op.isDeposit && op.depositDetails) {
      const fromAcc = op.depositDetails.fromAccount || cashAccountName;
      const toAcc = op.depositDetails.targetBank;
      if (accountName === fromAcc) return { side: 'RETRAIT', isOpex: false, contact: toAcc, motif: op.depositDetails.note || 'Versement banque' };
      if (accountName === toAcc) return { side: 'DEPOT', isOpex: false, contact: fromAcc, motif: op.depositDetails.note || 'Versement reçu' };
      return null;
    }

    // 2. Appro interne (from -> to)
    if (op.isTransfer && op.subtitle.includes('→')) {
      const [rawFrom, rawTo] = op.subtitle.split('→').map((s) => s.trim());
      if (accountName === rawFrom) return { side: 'RETRAIT', isOpex: false, contact: rawTo, motif: op.title };
      if (accountName === rawTo) return { side: 'DEPOT', isOpex: false, contact: rawFrom, motif: op.title };
      return null;
    }

    // 3. Virement client
    if (op.isClientTransfer) {
      const fromAcc = op.clientTransferDetails?.fromAccount || op.account || '';
      if (accountName === fromAcc) return { side: 'RETRAIT', isOpex: false, contact, motif };
      return null;
    }

    // 4. Opération explicitement rattachée à un compte
    let opAccount = op.account;
    if (!opAccount) {
      opAccount = knownAccountNames.find((k) => subLower.includes(k.toLowerCase())) || cashAccountName;
    }
    if (opAccount !== accountName) return null;

    return {
      side: op.isIncome ? 'DEPOT' : 'RETRAIT',
      isOpex,
      contact,
      motif,
    };
  };

  const doesOperationMatchContact = (op: LedgerEntry, contactQuery: string): boolean => {
    const q = contactQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      (op.depositor?.toLowerCase().includes(q) ?? false) ||
      (op.beneficiary?.toLowerCase().includes(q) ?? false) ||
      (op.clientTransferDetails?.clientName?.toLowerCase().includes(q) ?? false) ||
      op.title.toLowerCase().includes(q) ||
      op.subtitle.toLowerCase().includes(q)
    );
  };

  // Données de l'Aperçu du compte (T-account Dépôt | Retrait)
  const apercuLedger = useMemo(() => {
    const hasContactFilter = Boolean(caisseContact.trim()) && apercuFilterByContact;
    const deposits: Array<{ op: LedgerEntry; contact: string; motif: string }> = [];
    const withdrawals: Array<{ op: LedgerEntry; contact: string; motif: string; isOpex: boolean }> = [];

    for (const op of store.operations) {
      const classified = classifyOperationForAccount(op, caisseSourceAccount);
      if (!classified) continue;
      if (hasContactFilter && !doesOperationMatchContact(op, caisseContact)) continue;
      if (classified.side === 'DEPOT') {
        deposits.push({ op, contact: classified.contact, motif: classified.motif });
      } else {
        withdrawals.push({
          op,
          contact: classified.contact,
          motif: classified.motif,
          isOpex: classified.isOpex,
        });
      }
    }

    const totalDepot = deposits.reduce((sum, item) => sum + item.op.amount, 0);
    const totalRetrait = withdrawals.reduce((sum, item) => sum + item.op.amount, 0);
    const totalOpex = withdrawals
      .filter((item) => item.isOpex)
      .reduce((sum, item) => sum + item.op.amount, 0);

    return {
      hasContactFilter,
      deposits,
      withdrawals,
      totalDepot,
      totalRetrait,
      totalOpex,
      netBalance: totalDepot - totalRetrait,
    };
  }, [store.operations, caisseSourceAccount, caisseContact, apercuFilterByContact, knownAccountNames, cashAccountName]);

  // Historique filtré pour la colonne droite
  const searchedCaisseOperations = useMemo(() => {
    const q = searchOpQuery.trim().toLowerCase();
    return store.operations
      .map((op) => {
        const classified =
          historyScope === 'account'
            ? classifyOperationForAccount(op, caisseSourceAccount)
            : {
                side: (op.isIncome ? 'DEPOT' : 'RETRAIT') as 'DEPOT' | 'RETRAIT',
                isOpex: op.title.toLowerCase().startsWith('dépense'),
                contact:
                  op.depositor ||
                  op.beneficiary ||
                  op.clientTransferDetails?.clientName ||
                  op.title,
                motif: op.notes || op.subtitle,
              };
        return classified ? { op, ...classified } : null;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((item) => {
        if (historyTypeFilter === 'DEPOT' && item.side !== 'DEPOT') return false;
        if (historyTypeFilter === 'RETRAIT' && (item.side !== 'RETRAIT' || item.isOpex)) return false;
        if (historyTypeFilter === 'OPEX' && !item.isOpex) return false;
        if (!q) return true;
        return (
          item.op.title.toLowerCase().includes(q) ||
          item.op.subtitle.toLowerCase().includes(q) ||
          item.op.date.toLowerCase().includes(q) ||
          String(item.op.amount).includes(q) ||
          (item.op.notes?.toLowerCase().includes(q) ?? false) ||
          (item.op.reference?.toLowerCase().includes(q) ?? false) ||
          item.contact.toLowerCase().includes(q)
        );
      });
  }, [store.operations, searchOpQuery, historyScope, caisseSourceAccount, historyTypeFilter, knownAccountNames, cashAccountName]);

  // Execute Approvisionnement
  const handleAppro = (e: React.FormEvent) => {
    e.preventDefault();
    setApproSuccess(null);
    setApproError(null);
    const amount = parseFloat(approAmount.replace(',', '.') || '0');
    try {
      store.transferFunds({
        fromAccount: approFrom,
        toAccount: approTo,
        amount,
        label: approLabel.trim() || 'Appro Caisse',
      });
      setApproSuccess(`Approvisionnement de ${formatMoney(amount)} FCFA effectué avec succès.`);
      setApproAmount('');
      setApproLabel('');
    } catch (err: unknown) {
      setApproError(err instanceof Error ? err.message : String(err));
    }
  };

  // Execute Virement Client
  const handleClientTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    setClientTransferSuccess(null);
    setClientTransferError(null);

    const clientName = (isNewClient ? customClientName : (store.contacts.find(c => c.reference === selectedContactRef)?.name || customClientName)).trim();
    if (!clientName) {
      setClientTransferError('Veuillez sélectionner ou saisir le nom du client bénéficiaire.');
      return;
    }

    const amount = parseFloat(clientTransferAmount.replace(',', '.') || '0');
    if (amount <= 0 || !Number.isFinite(amount)) {
      setClientTransferError('Le montant du virement doit être supérieur à zéro.');
      return;
    }

    const feeAmount = clientTransferFee.trim() ? parseFloat(clientTransferFee.replace(',', '.') || '0') : 0;

    try {
      const newTransfer = store.transferToClient({
        fromAccount: clientTransferFrom,
        clientName,
        clientBank: clientBank.trim(),
        clientAccountNumber: clientAccountNumber.trim(),
        clientBankAgency: clientBankAgency.trim(),
        clientAccountHolder: clientAccountHolder.trim(),
        clientBankReference: clientBankReference.trim(),
        amount,
        feeAmount,
        reason: clientTransferReason.trim() || 'Règlement virement client',
      });

      const successMsg = `Virement de ${formatMoney(amount)} FCFA en faveur de ${clientName} effectué avec succès depuis ${clientTransferFrom}.`;
      setClientTransferSuccess(successMsg);

      setReceiptEntry(newTransfer);

      // Reset form fields
      setClientTransferAmount('');
      setClientTransferFee('');
      setClientTransferReason('');
      setClientBankAgency('');
      setClientAccountHolder('');
      setClientBankReference('');
    } catch (err: unknown) {
      setClientTransferError(err instanceof Error ? err.message : String(err));
    }
  };

  const approHistory = store.operations.filter((op) => op.isTransfer && !op.isDeposit);
  const clientTransfersHistory = store.operations.filter((op) => op.isClientTransfer);
  const bankDepositsHistory = store.operations.filter(
    (op) => op.isDeposit && (op.isTransfer || op.depositDetails || op.title.toLowerCase().includes('versement caisse'))
  );
  const allDepositsHistory = store.operations.filter((op) => op.isDeposit);

  // Classification chronologique de tous les flux qui touchent la Caisse
  interface CaisseFlowItem {
    id: string;
    rawDate: Date;
    displayDate: string;
    direction: 'IN' | 'OUT';
    category: string;
    title: string;
    subtitle: string;
    amount: number;
    rawOp?: LedgerEntry;
  }

  const allCaisseFlows = useMemo<CaisseFlowItem[]>(() => {
    const list: CaisseFlowItem[] = [];
    for (const op of store.operations) {
      const parsedDate = parseLedgerDate(op.date, op.createdAt);
      const titleLower = op.title.toLowerCase();
      const subLower = op.subtitle.toLowerCase();

      // 1. Versement Caisse -> Banque (Sortie de caisse)
      if (
        op.isDeposit &&
        (op.isTransfer || op.depositDetails || titleLower.includes('versement caisse') || subLower.includes('vers '))
      ) {
        list.push({
          id: op.id,
          rawDate: parsedDate,
          displayDate: op.date,
          direction: 'OUT',
          category: 'Versement en Banque',
          title: op.title,
          subtitle: op.subtitle,
          amount: op.amount,
          rawOp: op,
        });
        continue;
      }

      // 2. Vente or (versée directement en caisse = Entrée de caisse)
      if (
        (op.isDeposit && !op.isTransfer) ||
        titleLower.includes('vente') ||
        subLower.includes('versé en caisse')
      ) {
        list.push({
          id: op.id,
          rawDate: parsedDate,
          displayDate: op.date,
          direction: 'IN',
          category: 'Vente d’or (Recette)',
          title: op.title,
          subtitle: op.subtitle,
          amount: op.amount,
          rawOp: op,
        });
        continue;
      }

      // 3. Approvisionnements
      if (op.isTransfer) {
        if (subLower.includes('vers caisse') || subLower.endsWith('caisse (espèces)')) {
          list.push({
            id: op.id,
            rawDate: parsedDate,
            displayDate: op.date,
            direction: 'IN',
            category: 'Appro Caisse (Entrant)',
            title: op.title,
            subtitle: op.subtitle,
            amount: op.amount,
            rawOp: op,
          });
          continue;
        }
        if (subLower.includes('caisse vers') || subLower.startsWith('caisse')) {
          list.push({
            id: op.id,
            rawDate: parsedDate,
            displayDate: op.date,
            direction: 'OUT',
            category: 'Appro vers Banque (Sortant)',
            title: op.title,
            subtitle: op.subtitle,
            amount: op.amount,
            rawOp: op,
          });
          continue;
        }
      }

      // 4. Virement Client décaissé depuis la caisse
      if (op.isClientTransfer) {
        if (
          op.clientTransferDetails?.fromAccount?.toLowerCase().includes('caisse') ||
          subLower.includes('caisse')
        ) {
          list.push({
            id: op.id,
            rawDate: parsedDate,
            displayDate: op.date,
            direction: 'OUT',
            category: 'Virement Client (Caisse)',
            title: op.title,
            subtitle: op.subtitle,
            amount: op.amount,
            rawOp: op,
          });
          continue;
        }
      }

      // 5. Achat d'or payé en espèces (Sortie de caisse)
      if (titleLower.includes('achat')) {
        list.push({
          id: op.id,
          rawDate: parsedDate,
          displayDate: op.date,
          direction: 'OUT',
          category: 'Achat d’or (Espèces)',
          title: op.title,
          subtitle: op.subtitle,
          amount: op.amount,
          rawOp: op,
        });
        continue;
      }

      // 6. Dépense courante de caisse
      if (!op.isIncome && !op.isTransfer && !op.isClientTransfer) {
        list.push({
          id: op.id,
          rawDate: parsedDate,
          displayDate: op.date,
          direction: 'OUT',
          category: 'Dépense d’exploitation',
          title: op.title,
          subtitle: op.subtitle,
          amount: op.amount,
          rawOp: op,
        });
        continue;
      }

      // 7. Autre encaissement
      if (op.isIncome) {
        list.push({
          id: op.id,
          rawDate: parsedDate,
          displayDate: op.date,
          direction: 'IN',
          category: 'Autre Encaissement',
          title: op.title,
          subtitle: op.subtitle,
          amount: op.amount,
          rawOp: op,
        });
        continue;
      }
    }
    return list;
  }, [store.operations]);

  const filteredCaisseFlows = useMemo(() => {
    return allCaisseFlows.filter((flow) => isDateInPeriod(flow.rawDate, periodFilter));
  }, [allCaisseFlows, periodFilter]);

  const periodInflows = useMemo(
    () => filteredCaisseFlows.filter((f) => f.direction === 'IN'),
    [filteredCaisseFlows]
  );
  const periodOutflows = useMemo(
    () => filteredCaisseFlows.filter((f) => f.direction === 'OUT'),
    [filteredCaisseFlows]
  );

  const totalInflowsXaf = useMemo(
    () => periodInflows.reduce((sum, f) => sum + f.amount, 0),
    [periodInflows]
  );
  const totalOutflowsXaf = useMemo(
    () => periodOutflows.reduce((sum, f) => sum + f.amount, 0),
    [periodOutflows]
  );
  const netFlowXaf = totalInflowsXaf - totalOutflowsXaf;

  const inflowsByCategory = useMemo(() => {
    return periodInflows.reduce<Record<string, number>>((acc, f) => {
      acc[f.category] = (acc[f.category] || 0) + f.amount;
      return acc;
    }, {});
  }, [periodInflows]);

  const outflowsByCategory = useMemo(() => {
    return periodOutflows.reduce<Record<string, number>>((acc, f) => {
      acc[f.category] = (acc[f.category] || 0) + f.amount;
      return acc;
    }, {});
  }, [periodOutflows]);

  const displayedFlows = useMemo(() => {
    return filteredCaisseFlows.filter((f) => {
      if (operationsTypeFilter === 'IN') return f.direction === 'IN';
      if (operationsTypeFilter === 'OUT') return f.direction === 'OUT';
      return true;
    });
  }, [filteredCaisseFlows, operationsTypeFilter]);

  const quickBankSuggestions = ['Ecobank', 'UBA', 'Coris Bank', 'Afriland First Bank', 'BOA', 'BGFIBank', 'Société Générale', 'Wave', 'Orange Money', 'MTN MoMo'];

  return (
    <div className="p-4 sm:p-7 max-w-7xl mx-auto space-y-6">
      {!isPurchaseFormOpen && (
        <>
          <PageHeading eyebrow="Trésorerie · Opérations" title="Caisse & Mouvements" />

          {/* Tab Navigation */}
          <div className="flex items-center gap-2 border-b border-[#E8D8BE] pb-2 overflow-x-auto">
            {canAchat && (
              <button
                onClick={() => setActiveTab('achat')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
                  activeTab === 'achat'
                    ? 'bg-[#192A24] text-white shadow-xs'
                    : 'text-[#7D8176] hover:bg-[#F6F0E5]'
                }`}
              >
                <Wallet size={16} />
                <span>Achat d&apos;or</span>
              </button>
            )}

            {/* Tab: Caisse (Alimentation, Retraits & Dépenses) */}
            {canCaisse && (
              <button
                onClick={() => setActiveTab('depot_retrait')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
                  activeTab === 'depot_retrait'
                    ? 'bg-[#FFD27A] text-[#192A24] shadow-xs ring-2 ring-[#E7AD35]/50'
                    : 'text-[#9E731B] hover:bg-amber-100 bg-amber-50 border border-[#E7AD35]'
                }`}
              >
                <Banknote size={16} />
                <span>Caisse</span>
              </button>
            )}

            {/* Replaced 'Virements' by 'Appro' */}
            {canAppro && (
              <button
                onClick={() => setActiveTab('appro')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
                  activeTab === 'appro'
                    ? 'bg-[#192A24] text-white shadow-xs'
                    : 'text-[#7D8176] hover:bg-[#F6F0E5]'
                }`}
              >
                <ArrowLeftRight size={16} />
                <span>Appro ({approHistory.length + clientTransfersHistory.length})</span>
              </button>
            )}

            {/* Tab 5: Versements (Caisse -> Banque) */}
            {canVersements && (
              <button
                onClick={() => setActiveTab('versements')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
                  activeTab === 'versements'
                    ? 'bg-[#D39725] text-white shadow-xs'
                    : 'text-[#966308] hover:bg-amber-50'
                }`}
              >
                <ArrowDownLeft size={16} />
                <span>Versements (Caisse → Banque) ({bankDepositsHistory.length})</span>
              </button>
            )}

            {/* Tab 6: Entrées & Sorties par Période (Mois, Trimestre, Semestre, Annuel) */}
            {canFlux && (
              <button
                onClick={() => setActiveTab('flux_periodes')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
                  activeTab === 'flux_periodes'
                    ? 'bg-[#192A24] text-white shadow-xs ring-2 ring-[#D39725]/50'
                    : 'text-[#192A24] hover:bg-amber-50 bg-amber-50/60 border border-amber-200'
                }`}
              >
                <BarChart3 size={16} className="text-[#D39725]" />
                <span>Entrées & Sorties (Mois · Trimestre · Année)</span>
              </button>
            )}
          </div>
        </>
      )}

      {allowedCashTabs.length === 0 && (
        <AppPanel className="text-center py-10 text-xs text-gray-500">
          Aucun service n&apos;est autorisé dans le module Opérations (Caisse & Achats) pour ce compte.
        </AppPanel>
      )}

      {/* Tab 1: Achats */}
      {activeTab === 'achat' && canAchat && (
        <PurchasesScreen
          onFormVisibilityChanged={setIsPurchaseFormOpen}
          canCreatePurchase={canNewPurchase}
          canViewPurchaseHistory={canPurchaseList}
        />
      )}

      {/* Tab: Caisse — Interface Caisse en 3 colonnes (Saisie · Aperçu du compte · Historique) + Rapport */}
      {activeTab === 'depot_retrait' && canCaisse && (
        <div className="space-y-6">
          {/* En-tête de section Interface Caisse */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E8D8BE] pb-4">
            <div>
              <h2 className="text-xl font-bold text-[#192A24] tracking-tight">Interface Caisse</h2>
              <p className="text-xs text-[#7D8176]">
                Saisie unifiée des dépôts, retraits et dépenses OPEX avec aperçu en compte en T et historique en direct.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <div>
                <span className="text-[#7D8176]">Solde {caisseSourceAccount} : </span>
                <span
                  className={`font-mono tabular-nums font-bold ${
                    (store.bankBalances[caisseSourceAccount] ?? 0) < 0 ? 'text-red-700' : 'text-[#192A24]'
                  }`}
                >
                  {formatMoney(store.bankBalances[caisseSourceAccount] ?? 0)} FCFA
                </span>
              </div>
              {caisseSourceAccount !== cashAccountName && (
                <div>
                  <span className="text-[#7D8176]">{cashAccountName} : </span>
                  <span className="font-mono tabular-nums font-semibold text-[#192A24]">
                    {formatMoney(currentCashBalance)} FCFA
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Grille principale 3 colonnes conforme au schéma */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
            {/* COLONNE 1 : Saisie Caisse (Compte Source · Contact · Montant · Motif · Dépenses OPEX · Dépôt | Retrait) */}
            <div className="xl:col-span-4 bg-white border border-[#E8D8BE] rounded-2xl p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-[#F1E8D8] pb-3">
                  <h3 className="text-sm font-bold text-[#192A24]">Nouvelle opération</h3>
                  <input
                    type="date"
                    value={caisseDate}
                    onChange={(e) => setCaisseDate(e.target.value)}
                    aria-label="Date de l'opération"
                    className="px-2.5 py-1 bg-[#FAF8F3] border border-[#E8D8BE] rounded-lg text-xs font-mono tabular-nums text-[#192A24] focus:outline-none focus:ring-2 focus:ring-[#D39725]/40"
                  />
                </div>

                {caisseFeedback && (
                  <div
                    className={`p-3 rounded-xl border text-xs font-semibold flex items-start gap-2 ${
                      caisseFeedback.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-red-50 border-red-200 text-red-800'
                    }`}
                  >
                    {caisseFeedback.type === 'success' ? (
                      <CheckCircle2 size={15} className="shrink-0 mt-0.5 text-emerald-600" />
                    ) : (
                      <AlertCircle size={15} className="shrink-0 mt-0.5 text-red-600" />
                    )}
                    <span>{caisseFeedback.message}</span>
                  </div>
                )}

                {/* 1. Compte Source */}
                <div>
                  <label className="block text-xs font-semibold text-[#192A24] mb-1.5">
                    Compte Source
                  </label>
                  <select
                    value={caisseSourceAccount}
                    onChange={(e) => setCaisseSourceAccount(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs font-bold text-[#192A24] focus:outline-none focus:ring-2 focus:ring-[#D39725]/40"
                  >
                    {Object.entries(store.bankBalances).map(([accName, bal]) => (
                      <option key={accName} value={accName}>
                        {accName} ({formatMoney(bal)} FCFA)
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2. Contact (Fournisseur or/devise, Client, Gérant...) */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-[#192A24]">Contact</label>
                    {caisseContact && (
                      <button
                        type="button"
                        onClick={() => setCaisseContact('')}
                        className="text-[11px] font-semibold text-[#7D8176] hover:text-[#192A24] cursor-pointer"
                      >
                        Effacer
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      list="caisse-contacts-datalist"
                      value={caisseContact}
                      onChange={(e) => setCaisseContact(e.target.value)}
                      placeholder="Fournisseur or/devise, client, gérant..."
                      className="w-full px-3.5 py-2.5 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs font-semibold text-[#192A24] focus:outline-none focus:ring-2 focus:ring-[#D39725]/40"
                    />
                    <datalist id="caisse-contacts-datalist">
                      {clientContacts.map((contact) => (
                        <option key={contact.reference} value={contact.name}>
                          {contact.roles.join(' / ')}
                        </option>
                      ))}
                    </datalist>
                  </div>
                  {clientContacts.length > 0 && (
                    <select
                      value={
                        clientContacts.some((c) => c.name === caisseContact) ? caisseContact : ''
                      }
                      onChange={(e) => {
                        if (e.target.value) setCaisseContact(e.target.value);
                      }}
                      aria-label="Sélectionner un contact enregistré"
                      className="mt-1.5 w-full px-3 py-1.5 bg-white rounded-lg border border-[#EFE6D5] text-[11px] text-[#7D8176] focus:outline-none focus:border-[#D39725]"
                    >
                      <option value="">Choisir dans le répertoire ({clientContacts.length})...</option>
                      {clientContacts.map((contact) => (
                        <option key={contact.reference} value={contact.name}>
                          {contact.name} · {contact.roles[0] || contact.reference}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* 3. Montant */}
                <div>
                  <label className="block text-xs font-semibold text-[#192A24] mb-1.5">
                    Montant (FCFA)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={caisseAmount}
                    onChange={(e) => setCaisseAmount(e.target.value)}
                    placeholder="0"
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] font-mono tabular-nums font-bold text-base text-[#192A24] focus:outline-none focus:ring-2 focus:ring-[#D39725]/40"
                  />
                </div>

                {/* 4. Motif */}
                <div>
                  <label className="block text-xs font-semibold text-[#192A24] mb-1.5">
                    Motif
                  </label>
                  <input
                    type="text"
                    value={caisseMotif}
                    onChange={(e) => setCaisseMotif(e.target.value)}
                    placeholder={
                      caisseOpexMode
                        ? 'ex: Loyer bureau, transport, électricité...'
                        : 'ex: Avance achat or, règlement devise, retrait...'
                    }
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs font-medium text-[#192A24] focus:outline-none focus:ring-2 focus:ring-[#D39725]/40"
                  />
                </div>

                {/* 5. Dépenses OPEX toggle + sélecteur de catégorie */}
                {canDepenses && (
                  <div className="space-y-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setCaisseOpexMode((prev) => !prev)}
                      className={`w-full py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-between transition-colors cursor-pointer whitespace-nowrap ${
                        caisseOpexMode
                          ? 'bg-[#192A24] text-white border-[#192A24]'
                          : 'bg-[#FAF8F3] text-[#192A24] border-[#E8D8BE] hover:bg-[#F3EBDC]'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Receipt size={14} />
                        <span>Dépenses OPEX</span>
                      </span>
                      <span className="text-[11px] opacity-80">
                        {caisseOpexMode ? 'Actif' : 'Activer'}
                      </span>
                    </button>

                    {caisseOpexMode && (
                      <div>
                        <label className="block text-[11px] font-semibold text-[#7D8176] mb-1">
                          Catégorie de dépense OPEX
                        </label>
                        <select
                          value={caisseOpexCategory}
                          onChange={(e) => setCaisseOpexCategory(e.target.value)}
                          className="w-full px-3 py-2 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs font-semibold text-[#192A24]"
                        >
                          {EXPENSE_CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 6. Barre d'action scindée : Dépôt | Retrait */}
              <div className="pt-2">
                <div className="grid grid-cols-2 rounded-xl overflow-hidden border border-[#E8D8BE]">
                  <button
                    type="button"
                    disabled={!canDepotRetrait}
                    onClick={handleCaisseDepot}
                    className={`py-3 px-4 text-xs font-bold flex items-center justify-center gap-1.5 border-r border-[#E8D8BE] transition-colors whitespace-nowrap ${
                      canDepotRetrait
                        ? 'bg-[#008B62] hover:bg-[#007452] text-white cursor-pointer'
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    <ArrowDownLeft size={15} />
                    <span>Dépôt</span>
                  </button>
                  <button
                    type="button"
                    disabled={caisseOpexMode ? !canDepenses : !canDepotRetrait}
                    onClick={handleCaisseRetrait}
                    className={`py-3 px-4 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                      (caisseOpexMode ? canDepenses : canDepotRetrait)
                        ? caisseOpexMode
                          ? 'bg-[#192A24] hover:bg-[#253D34] text-white cursor-pointer'
                          : 'bg-[#DC2626] hover:bg-[#B91C1C] text-white cursor-pointer'
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    <ArrowUpRight size={15} />
                    <span>{caisseOpexMode ? 'Retrait OPEX' : 'Retrait'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* COLONNE 2 : Aperçu du compte (Compte en T : Dépôt | Retrait) */}
            <div className="xl:col-span-4 bg-white border border-[#E8D8BE] rounded-2xl flex flex-col overflow-hidden">
              <div className="p-4 border-b border-[#E8D8BE] bg-[#FFFDF9] space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-[#192A24]">Aperçu du compte</h3>
                    <div className="text-[11px] text-[#7D8176]">
                      {apercuLedger.hasContactFilter
                        ? `${caisseSourceAccount} · ${caisseContact.trim()}`
                        : caisseSourceAccount}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-[#7D8176]">Solde actuel</div>
                    <div
                      className={`text-sm font-mono tabular-nums font-bold ${
                        (store.bankBalances[caisseSourceAccount] ?? 0) < 0
                          ? 'text-red-700'
                          : 'text-[#192A24]'
                      }`}
                    >
                      {formatMoney(store.bankBalances[caisseSourceAccount] ?? 0)} F
                    </div>
                  </div>
                </div>

                {caisseContact.trim() && (
                  <div className="flex items-center gap-1 p-1 bg-[#FAF8F3] border border-[#E8D8BE] rounded-lg text-[11px]">
                    <button
                      type="button"
                      onClick={() => setApercuFilterByContact(true)}
                      className={`flex-1 py-1 px-2 rounded-md font-semibold transition-colors cursor-pointer truncate ${
                        apercuFilterByContact
                          ? 'bg-white text-[#192A24] shadow-2xs'
                          : 'text-[#7D8176] hover:text-[#192A24]'
                      }`}
                    >
                      Contact : {caisseContact.trim()}
                    </button>
                    <button
                      type="button"
                      onClick={() => setApercuFilterByContact(false)}
                      className={`py-1 px-2.5 rounded-md font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                        !apercuFilterByContact
                          ? 'bg-white text-[#192A24] shadow-2xs'
                          : 'text-[#7D8176] hover:text-[#192A24]'
                      }`}
                    >
                      Tout le compte
                    </button>
                  </div>
                )}
              </div>

              {/* Tableau Compte en T : Dépôt (gauche) | Retrait (droite) */}
              <div className="grid grid-cols-2 border-b border-[#E8D8BE] bg-[#FAF8F3] text-xs font-bold text-[#192A24]">
                <div className="py-2.5 px-3 border-r border-[#E8D8BE] flex items-center justify-between">
                  <span>Dépôt</span>
                  <span className="font-mono tabular-nums text-[11px] text-emerald-700">
                    {apercuLedger.deposits.length}
                  </span>
                </div>
                <div className="py-2.5 px-3 flex items-center justify-between">
                  <span>Retrait</span>
                  <span className="font-mono tabular-nums text-[11px] text-red-700">
                    {apercuLedger.withdrawals.length}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 flex-1 min-h-[300px] max-h-[420px] overflow-y-auto">
                {/* Colonne Dépôt */}
                <div className="border-r border-[#E8D8BE] divide-y divide-[#F3EBDC]">
                  {apercuLedger.deposits.length === 0 ? (
                    <div className="p-4 text-[11px] text-[#7D8176] text-center">
                      Aucun dépôt enregistré
                    </div>
                  ) : (
                    apercuLedger.deposits.map(({ op, contact, motif }) => (
                      <div key={op.id} className="p-2.5 hover:bg-emerald-50/30 transition-colors">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs font-semibold text-[#192A24] truncate">
                            {contact}
                          </span>
                          <span className="text-xs font-mono tabular-nums font-bold text-emerald-700 shrink-0">
                            +{formatMoney(op.amount)}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#7D8176] truncate mt-0.5">
                          {op.date} · {motif}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Colonne Retrait */}
                <div className="divide-y divide-[#F3EBDC]">
                  {apercuLedger.withdrawals.length === 0 ? (
                    <div className="p-4 text-[11px] text-[#7D8176] text-center">
                      Aucun retrait enregistré
                    </div>
                  ) : (
                    apercuLedger.withdrawals.map(({ op, contact, motif, isOpex }) => (
                      <div key={op.id} className="p-2.5 hover:bg-red-50/30 transition-colors">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs font-semibold text-[#192A24] truncate">
                            {isOpex ? `OPEX · ${contact}` : contact}
                          </span>
                          <span className="text-xs font-mono tabular-nums font-bold text-red-700 shrink-0">
                            -{formatMoney(op.amount)}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#7D8176] truncate mt-0.5">
                          {op.date} · {motif}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Totaux Dépôt / Retrait + Différence nette */}
              <div className="border-t border-[#E8D8BE] bg-[#FAF8F3]">
                <div className="grid grid-cols-2 border-b border-[#EFE6D5] text-xs">
                  <div className="py-2 px-3 border-r border-[#E8D8BE] flex items-center justify-between gap-1">
                    <span className="text-[#7D8176] font-medium">Total</span>
                    <span className="font-mono tabular-nums font-bold text-emerald-700">
                      {formatMoney(apercuLedger.totalDepot)} F
                    </span>
                  </div>
                  <div className="py-2 px-3 flex items-center justify-between gap-1">
                    <span className="text-[#7D8176] font-medium">Total</span>
                    <span className="font-mono tabular-nums font-bold text-red-700">
                      {formatMoney(apercuLedger.totalRetrait)} F
                    </span>
                  </div>
                </div>
                <div className="py-2.5 px-3 flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#192A24]">
                    {apercuLedger.hasContactFilter ? 'Solde contact (Dépôt − Retrait)' : 'Net (Dépôt − Retrait)'}
                  </span>
                  <span
                    className={`font-mono tabular-nums font-bold ${
                      apercuLedger.netBalance < 0 ? 'text-red-700' : 'text-emerald-700'
                    }`}
                  >
                    {apercuLedger.netBalance >= 0 ? '+' : ''}
                    {formatMoney(apercuLedger.netBalance)} FCFA
                  </span>
                </div>
              </div>
            </div>

            {/* COLONNE 3 : Historique */}
            <div className="xl:col-span-4 bg-white border border-[#E8D8BE] rounded-2xl flex flex-col overflow-hidden">
              <div className="p-4 border-b border-[#E8D8BE] bg-[#FFFDF9] space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-[#192A24]">Historique</h3>
                  <div className="flex items-center gap-1 p-0.5 bg-[#FAF8F3] border border-[#E8D8BE] rounded-lg text-[11px]">
                    <button
                      type="button"
                      onClick={() => setHistoryScope('account')}
                      className={`px-2 py-1 rounded-md font-semibold cursor-pointer transition-colors whitespace-nowrap ${
                        historyScope === 'account'
                          ? 'bg-white text-[#192A24] shadow-2xs'
                          : 'text-[#7D8176] hover:text-[#192A24]'
                      }`}
                    >
                      Ce compte
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryScope('all')}
                      className={`px-2 py-1 rounded-md font-semibold cursor-pointer transition-colors whitespace-nowrap ${
                        historyScope === 'all'
                          ? 'bg-white text-[#192A24] shadow-2xs'
                          : 'text-[#7D8176] hover:text-[#192A24]'
                      }`}
                    >
                      Tous
                    </button>
                  </div>
                </div>

                {/* Recherche */}
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-2.5 text-[#7D8176]" />
                  <input
                    type="text"
                    value={searchOpQuery}
                    onChange={(e) => setSearchOpQuery(e.target.value)}
                    placeholder="Rechercher contact, motif, montant..."
                    className="w-full pl-8 pr-8 py-2 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs font-medium text-[#192A24] focus:outline-none focus:ring-2 focus:ring-[#D39725]/40"
                  />
                  {searchOpQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchOpQuery('')}
                      aria-label="Effacer la recherche"
                      className="absolute right-2.5 top-2.5 text-[#7D8176] hover:text-[#192A24] cursor-pointer"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* Filtre rapide par nature */}
                <div className="flex items-center gap-1 p-1 bg-[#FAF8F3] border border-[#E8D8BE] rounded-lg text-[11px]">
                  {(
                    [
                      ['ALL', 'Tout'],
                      ['DEPOT', 'Dépôts'],
                      ['RETRAIT', 'Retraits'],
                      ['OPEX', 'OPEX'],
                    ] as const
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setHistoryTypeFilter(val)}
                      className={`flex-1 py-1 px-2 rounded-md font-semibold cursor-pointer transition-colors whitespace-nowrap ${
                        historyTypeFilter === val
                          ? 'bg-white text-[#192A24] shadow-2xs'
                          : 'text-[#7D8176] hover:text-[#192A24]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 min-h-[300px] max-h-[420px] overflow-y-auto divide-y divide-[#F3EBDC]">
                {searchedCaisseOperations.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[#7D8176]">
                    {searchOpQuery
                      ? `Aucune opération trouvée pour « ${searchOpQuery} ».`
                      : 'Aucune opération enregistrée pour ce filtre.'}
                  </div>
                ) : (
                  searchedCaisseOperations.slice(0, 40).map(({ op, side, isOpex, motif }) => (
                    <div
                      key={op.id}
                      className="p-3 hover:bg-[#FAF8F3] transition-colors flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="text-xs font-bold text-[#192A24] truncate">{op.title}</div>
                        <div className="text-[11px] text-[#7D8176] truncate">
                          {op.date} · {isOpex ? 'Dépense OPEX' : side === 'DEPOT' ? 'Dépôt' : 'Retrait'} · {motif}
                        </div>
                      </div>
                      <div className="text-right shrink-0 space-y-1">
                        <div
                          className={`text-xs font-mono tabular-nums font-bold ${
                            side === 'DEPOT' ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {side === 'DEPOT' ? '+' : '-'}
                          {formatMoney(op.amount)} F
                        </div>
                        <button
                          type="button"
                          onClick={() => handleOpenEditOp(op)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#7D8176] hover:text-[#192A24] cursor-pointer"
                        >
                          <Edit3 size={11} />
                          <span>Modifier</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="p-2.5 border-t border-[#E8D8BE] bg-[#FAF8F3] flex items-center justify-between text-[11px] text-[#7D8176]">
                <span>
                  {searchedCaisseOperations.length} opération{searchedCaisseOperations.length > 1 ? 's' : ''}
                </span>
                {searchedCaisseOperations.length > 40 && <span>40 plus récentes affichées</span>}
              </div>
            </div>
          </div>

          {/* SECTION BASSE : Rapport de la caisse */}
          <div className="bg-white border border-[#E8D8BE] rounded-2xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-[#192A24]">Rapport de la caisse</h3>
              <p className="text-xs text-[#7D8176]">
                Synthèse des flux sur {caisseSourceAccount}
                {apercuLedger.hasContactFilter ? ` · Contact : ${caisseContact.trim()}` : ''}.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 lg:gap-6">
              <div>
                <div className="text-[11px] text-[#7D8176]">Total Dépôts</div>
                <div className="text-sm font-mono tabular-nums font-bold text-emerald-700">
                  +{formatMoney(apercuLedger.totalDepot)} FCFA
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#7D8176]">Total Retraits</div>
                <div className="text-sm font-mono tabular-nums font-bold text-red-700">
                  -{formatMoney(apercuLedger.totalRetrait)} FCFA
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#7D8176]">Dont Dépenses OPEX</div>
                <div className="text-sm font-mono tabular-nums font-bold text-[#192A24]">
                  {formatMoney(apercuLedger.totalOpex)} FCFA
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#7D8176]">Solde du compte</div>
                <div
                  className={`text-sm font-mono tabular-nums font-bold ${
                    (store.bankBalances[caisseSourceAccount] ?? 0) < 0 ? 'text-red-700' : 'text-[#192A24]'
                  }`}
                >
                  {formatMoney(store.bankBalances[caisseSourceAccount] ?? 0)} FCFA
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {canFlux && (
                <button
                  type="button"
                  onClick={() => setActiveTab('flux_periodes')}
                  className="px-3.5 py-2 rounded-xl bg-[#FAF8F3] border border-[#E8D8BE] hover:bg-[#F3EBDC] text-xs font-bold text-[#192A24] cursor-pointer whitespace-nowrap transition-colors"
                >
                  Rapport détaillé par période
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsCaisseReportPrintOpen(true)}
                className="px-3.5 py-2 rounded-xl bg-[#192A24] hover:bg-[#253D34] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
              >
                <Printer size={14} />
                <span>Imprimer</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'appro' && canAppro && (
        <div className="flex items-center gap-2 border-b border-[#E8D8BE] pb-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setApproView('internal')}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
              approView === 'internal'
                ? 'bg-[#FFD27A] text-[#192A24] border border-[#E7AD35]'
                : 'text-[#7D8176] hover:bg-amber-50'
            }`}
          >
            Transferts entre comptes ({approHistory.length})
          </button>
          <button
            type="button"
            onClick={() => setApproView('client')}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
              approView === 'client'
                ? 'bg-[#FFD27A] text-[#192A24] border border-[#E7AD35]'
                : 'text-[#7D8176] hover:bg-amber-50'
            }`}
          >
            Transactions avec les clients ({clientTransfersHistory.length})
          </button>
        </div>
      )}

      {/* Tab 2: Appro (transactions entre comptes et avec les clients) */}
      {activeTab === 'appro' && canAppro && approView === 'internal' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <AppPanel className="lg:col-span-1">
            <SectionHeading title="Nouvel Appro (Approvisionnement interne)" icon={<ArrowLeftRight size={18} />} />
            <p className="text-[11px] text-[#7D8176] mb-4">
              Transférer des fonds en interne entre la caisse espèces et les comptes bancaires du comptoir.
            </p>

            {approSuccess && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-bold flex items-center gap-2">
                <CheckCircle2 size={16} />
                <span>{approSuccess}</span>
              </div>
            )}

            {approError && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-bold flex items-center gap-2">
                <AlertCircle size={16} />
                <span>{approError}</span>
              </div>
            )}

            <form onSubmit={handleAppro} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#192A24] mb-1">Compte Source (Débit)</label>
                <select
                  value={approFrom}
                  onChange={(e) => setApproFrom(e.target.value)}
                  className="w-full px-3 py-2 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs font-semibold text-[#192A24]"
                >
                  {Object.entries(store.bankBalances).map(([b, bal]) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#192A24] mb-1">Compte Cible (Crédit)</label>
                <select
                  value={approTo}
                  onChange={(e) => setApproTo(e.target.value)}
                  className="w-full px-3 py-2 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs font-semibold text-[#192A24]"
                >
                  {Object.entries(store.bankBalances)
                    .filter(([b]) => b !== approFrom)
                    .map(([b, bal]) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#192A24] mb-1">Montant de l'appro (FCFA)</label>
                <input
                  type="text"
                  required
                  value={approAmount}
                  onChange={(e) => setApproAmount(e.target.value)}
                  placeholder="ex: 1000000"
                  className="w-full px-3 py-2 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#192A24] mb-1">Libellé / Motif de l'appro</label>
                <input
                  type="text"
                  required
                  value={approLabel}
                  onChange={(e) => setApproLabel(e.target.value)}
                  placeholder="ex: Appro Caisse pour achats d'or"
                  className="w-full px-3 py-2 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-[#192A24] hover:bg-[#253D34] text-white text-xs font-bold transition-colors cursor-pointer"
              >
                Effectuer l'appro
              </button>
            </form>
          </AppPanel>

          <AppPanel className="lg:col-span-2">
            <SectionHeading title="Historique des approvisionnements" icon={<ArrowLeftRight size={18} />} />
            {approHistory.length === 0 ? (
              <p className="text-xs text-gray-500 py-6 text-center">Aucun approvisionnement enregistré.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {approHistory.map((op) => (
                  <div key={op.id} className="py-3 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-bold text-[#192A24]">{op.title}</div>
                      <div className="text-[11px] text-[#7D8176]">
                        {op.subtitle} · {op.date}
                      </div>
                    </div>
                    <span className="font-extrabold text-blue-600 font-mono">
                      {formatMoney(op.amount)} FCFA
                    </span>
                  </div>
                ))}
              </div>
            )}
          </AppPanel>
        </div>
      )}

      {/* Transactions between company accounts and clients */}
      {activeTab === 'appro' && canAppro && approView === 'client' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <AppPanel className="lg:col-span-1 border-emerald-200 shadow-md">
            <div className="flex items-center gap-2 border-b border-[#E8D8BE] pb-3 mb-4">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center">
                <Send size={18} />
              </div>
              <div>
                <h3 className="text-sm font-black text-[#192A24]">Virement vers compte client</h3>
                <p className="text-[11px] text-[#7D8176]">Débiter mon compte pour payer un client par virement</p>
              </div>
            </div>

            {clientTransferSuccess && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-bold space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
                  <span>{clientTransferSuccess}</span>
                </div>
                {receiptEntry && (
                  <button
                    type="button"
                    onClick={() => setReceiptEntry(receiptEntry)}
                    className="w-full py-1.5 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Printer size={13} />
                    <span>Afficher / Imprimer le reçu de virement</span>
                  </button>
                )}
              </div>
            )}

            {clientTransferError && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-bold flex items-center gap-2">
                <AlertCircle size={16} />
                <span>{clientTransferError}</span>
              </div>
            )}

            <form onSubmit={handleClientTransfer} className="space-y-4">
              {/* Mon Compte Source */}
              <div>
                <label className="block text-xs font-bold text-[#192A24] mb-1">
                  Mon compte source (Débité)
                </label>
                <select
                  value={clientTransferFrom}
                  onChange={(e) => setClientTransferFrom(e.target.value)}
                  className="w-full px-3 py-2 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs font-bold text-[#192A24] focus:outline-hidden focus:border-[#008B62]"
                >
                  {Object.entries(store.bankBalances).map(([b, bal]) => (
                    <option key={b} value={b}>
                      {b} — Solde dispo : {formatMoney(bal)} FCFA
                    </option>
                  ))}
                </select>
              </div>

              {/* Client Bénéficiaire */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-[#192A24]">
                    Client bénéficiaire
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsNewClient(!isNewClient)}
                    className="text-[11px] text-[#008B62] font-bold hover:underline cursor-pointer"
                  >
                    {isNewClient ? 'Choisir contact enregistré' : '+ Nouveau / Client libre'}
                  </button>
                </div>

                {!isNewClient ? (
                  <select
                    value={selectedContactRef}
                    onChange={(e) => handleSelectContact(e.target.value)}
                    className="w-full px-3 py-2 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs font-semibold text-[#192A24]"
                  >
                    <option value="">-- Choisir un client dans le carnet --</option>
                    {clientContacts.map((c) => (
                      <option key={c.reference} value={c.reference}>
                        {c.name} ({c.city}) {c.phone ? `· ${c.phone}` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    required
                    value={customClientName}
                    onChange={(e) => setCustomClientName(e.target.value)}
                    placeholder="Nom complet du client bénéficiaire"
                    className="w-full px-3 py-2 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs font-bold text-[#192A24]"
                  />
                )}
              </div>

              {/* Banque du client */}
              <div>
                <label className="block text-xs font-bold text-[#192A24] mb-1">
                  Banque / Opérateur du client
                </label>
                <input
                  type="text"
                  required
                  value={clientBank}
                  onChange={(e) => setClientBank(e.target.value)}
                  placeholder="ex: Ecobank, UBA, Wave..."
                  className="w-full px-3 py-2 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs font-semibold text-[#192A24]"
                />
                {/* Quick suggestions pills */}
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {quickBankSuggestions.slice(0, 5).map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setClientBank(b)}
                      className="px-2 py-0.5 rounded-md bg-gray-100 hover:bg-emerald-100 text-[10px] text-gray-700 font-semibold cursor-pointer transition-colors"
                    >
                      {b}
                    </button>
                  ))}
                </div>
                {clientBank.trim() && (
                  <div className="mt-3 p-3 rounded-xl bg-emerald-50/60 border border-emerald-200 space-y-3">
                    <div className="text-[11px] font-black text-emerald-900">
                      Informations complémentaires du bordereau
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-[#192A24] mb-1">
                          Agence bancaire
                        </label>
                        <input
                          type="text"
                          value={clientBankAgency}
                          onChange={(e) => setClientBankAgency(e.target.value)}
                          placeholder="Nom ou code de l’agence"
                          className="w-full px-3 py-2 bg-white rounded-xl border border-emerald-200 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-[#192A24] mb-1">
                          Titulaire du compte
                        </label>
                        <input
                          type="text"
                          value={clientAccountHolder}
                          onChange={(e) => setClientAccountHolder(e.target.value)}
                          placeholder="Nom indiqué sur le compte"
                          className="w-full px-3 py-2 bg-white rounded-xl border border-emerald-200 text-xs"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-[#192A24] mb-1">
                        Référence bancaire
                      </label>
                      <input
                        type="text"
                        value={clientBankReference}
                        onChange={(e) => setClientBankReference(e.target.value)}
                        placeholder="Référence de l’ordre ou du transfert"
                        className="w-full px-3 py-2 bg-white rounded-xl border border-emerald-200 text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Numéro de compte / RIB */}
              <div>
                <label className="block text-xs font-bold text-[#192A24] mb-1">
                  Numéro de compte / RIB / IBAN / N° Mobile
                </label>
                <input
                  type="text"
                  required
                  value={clientAccountNumber}
                  onChange={(e) => setClientAccountNumber(e.target.value)}
                  placeholder="ex: 12345678901 ou 0708091011"
                  className="w-full px-3 py-2 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs font-mono font-bold text-[#192A24]"
                />
              </div>

              {/* Montant & Frais */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#192A24] mb-1">
                    Montant du virement (FCFA)
                  </label>
                  <input
                    type="text"
                    required
                    value={clientTransferAmount}
                    onChange={(e) => setClientTransferAmount(e.target.value)}
                    placeholder="ex: 2500000"
                    className="w-full px-3 py-2 bg-emerald-50/50 rounded-xl border border-emerald-300 text-xs font-black text-[#192A24]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#192A24] mb-1">
                    Frais bancaires (FCFA)
                  </label>
                  <input
                    type="text"
                    value={clientTransferFee}
                    onChange={(e) => setClientTransferFee(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs font-semibold text-[#192A24]"
                  />
                </div>
              </div>

              {/* Motif / Référence */}
              <div>
                <label className="block text-xs font-bold text-[#192A24] mb-1">
                  Motif / Référence du virement
                </label>
                <input
                  type="text"
                  required
                  value={clientTransferReason}
                  onChange={(e) => setClientTransferReason(e.target.value)}
                  placeholder="ex: Règlement achat or lot ACH-2026-0004"
                  className="w-full px-3 py-2 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs text-[#192A24]"
                />
              </div>

              {/* Dynamic Summary Card */}
              {clientTransferAmount && parseFloat(clientTransferAmount.replace(',', '.') || '0') > 0 && (
                <div className="p-3.5 rounded-xl bg-gradient-to-r from-[#192A24] to-[#253D34] text-white text-xs space-y-1.5 shadow-sm">
                  <div className="flex justify-between items-center text-white/80">
                    <span>Net transféré au client :</span>
                    <strong className="text-white font-mono">{formatMoney(parseFloat(clientTransferAmount.replace(',', '.') || '0'))} FCFA</strong>
                  </div>
                  {clientTransferFee && parseFloat(clientTransferFee.replace(',', '.') || '0') > 0 && (
                    <div className="flex justify-between items-center text-white/70 text-[11px]">
                      <span>Frais bancaires déduits :</span>
                      <span>+{formatMoney(parseFloat(clientTransferFee.replace(',', '.') || '0'))} FCFA</span>
                    </div>
                  )}
                  <div className="border-t border-white/10 pt-1.5 flex justify-between items-center text-[#F2BD45] font-black text-sm">
                    <span>Débit total de {clientTransferFrom} :</span>
                    <span>
                      {formatMoney(
                        parseFloat(clientTransferAmount.replace(',', '.') || '0') +
                        (parseFloat(clientTransferFee.replace(',', '.') || '0') || 0)
                      )} FCFA
                    </span>
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-[#008B62] hover:bg-[#007452] text-white text-xs font-black transition-all cursor-pointer shadow-md flex items-center justify-center gap-2"
              >
                <Send size={15} />
                <span>Valider le virement au client</span>
              </button>
            </form>
          </AppPanel>

          {/* Right column: Historique des virements clients */}
          <AppPanel className="lg:col-span-2">
            <div className="flex items-center justify-between border-b border-[#E8D8BE] pb-3 mb-4">
              <SectionHeading title="Historique des virements vers clients" icon={<Send size={18} className="text-[#008B62]" />} />
              <span className="text-xs font-bold text-[#008B62] bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                {clientTransfersHistory.length} virement(s) effectué(s)
              </span>
            </div>

            {clientTransfersHistory.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto">
                  <Send size={22} />
                </div>
                <p className="text-xs font-bold text-gray-700">Aucun virement client enregistré pour le moment.</p>
                <p className="text-[11px] text-gray-500">Utilisez le formulaire à gauche pour effectuer un virement de votre compte vers un client.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {clientTransfersHistory.map((op) => {
                  const details = op.clientTransferDetails;
                  return (
                    <div key={op.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs hover:bg-[#FAF8F3] px-2 rounded-xl transition-colors">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-sm text-[#192A24]">{op.title}</span>
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                            Virement exécuté
                          </span>
                        </div>
                        <div className="text-[11px] text-[#7D8176] font-medium">
                          {op.subtitle}
                        </div>
                        {details && (
                          <div className="text-[10px] text-gray-500 flex items-center gap-3">
                            <span>Banque : <strong>{details.clientBank || 'N/A'}</strong></span>
                            {details.clientAccountNumber && <span>N° Compte : <strong className="font-mono">{details.clientAccountNumber}</strong></span>}
                            <span>Débité de : <strong>{details.fromAccount}</strong></span>
                          </div>
                        )}
                      </div>

                      <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2">
                        <span className="font-black text-sm text-emerald-700 font-mono">
                          {formatMoney(op.amount)} FCFA
                        </span>
                        <button
                          type="button"
                          onClick={() => setReceiptEntry(op)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-[#E8D8BE] hover:bg-emerald-50 text-[11px] font-bold text-[#192A24] cursor-pointer shadow-2xs transition-colors"
                        >
                          <Printer size={12} className="text-[#008B62]" />
                          <span>Voir reçu</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </AppPanel>
        </div>
      )}

      {/* Tab 5: Versements (Caisse -> Compte bancaire) */}
      {activeTab === 'versements' && canVersements && (
        <div className="space-y-6">
          {/* Informational Hero Card */}
          <div className="bg-[#FAF8F3] border border-[#E8D8BE] p-4 sm:p-5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-[#D39725]/15 text-[#966308] flex items-center justify-center shrink-0">
                <ArrowDownLeft size={24} />
              </div>
              <div>
                <h3 className="text-sm font-black text-[#192A24]">
                  Versement d'espèces de la Caisse vers un Compte Bancaire
                </h3>
                <p className="text-xs text-[#7D8176] mt-0.5">
                  Dépôt physique des liquidités de la caisse espèces du comptoir vers les comptes bancaires (Ecobank, UBA, etc.). Débite la caisse et crédite le compte bancaire avec génération de bordereau.
                </p>
              </div>
            </div>

          </div>

          {/* Formulaire complet de versement conforme au bordereau officiel */}
          <AppPanel className="p-5 sm:p-6">
            <SectionHeading
              title="Saisie du Bordereau de Versement (Caisse → Banque)"
              icon={<ArrowDownLeft size={18} />}
            />
            <div className="mt-4">
              <BankDepositForm
                onSuccess={(newOp) => {
                  setSelectedDepositReceipt(newOp);
                }}
                onOpenSlipPreview={(tempOp) => {
                  setSelectedDepositReceipt(tempOp as LedgerEntry);
                }}
              />
            </div>
          </AppPanel>

          {/* Bank Deposits History */}
          <AppPanel className="p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <SectionHeading
                title="Historique des versements en banque & Bordereaux émis"
                icon={<Landmark size={18} />}
              />
              <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-lg self-start sm:self-auto">
                {bankDepositsHistory.length} versement(s)
              </span>
            </div>

            {bankDepositsHistory.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <div className="w-12 h-12 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center mx-auto">
                  <ArrowDownLeft size={24} />
                </div>
                <p className="text-xs font-bold text-gray-600">Aucun versement d'espèces en banque pour le moment.</p>
                <p className="text-[11px] text-gray-400 max-w-sm mx-auto">
                  Utilisez le formulaire ci-dessus pour transférer des espèces de la caisse physique vers vos comptes bancaires d'entreprise avec le décompte exact des coupures.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {bankDepositsHistory.map((op) => {
                  const details = op.depositDetails;
                  const targetBankName = details?.targetBank || (op.title.includes('→') ? op.title.split('→')[1].trim() : 'Banque');
                  return (
                    <div
                      key={op.id}
                      className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs hover:bg-[#FAF8F3]/60 px-2 rounded-xl transition-colors"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md bg-amber-100 text-[#966308] text-[10px] font-black uppercase">
                            Caisse → {targetBankName}
                          </span>
                          <span className="font-bold text-[#192A24] text-xs">
                            {op.title}
                          </span>
                        </div>

                        <div className="text-[11px] text-[#7D8176] flex flex-wrap items-center gap-2">
                          <span>{op.date}</span>
                          {details?.slipNumber && (
                            <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-700">
                              Bordereau : {details.slipNumber}
                            </span>
                          )}
                          {details?.depositedBy && (
                            <span>Déposant : <strong>{details.depositedBy}</strong></span>
                          )}
                          {details?.shiftPeriod && (
                            <span className="px-1.5 py-0.5 rounded bg-gray-100 font-bold text-gray-600 text-[10px]">
                              {details.shiftPeriod}
                            </span>
                          )}
                          {details?.denominations && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-[10px] text-emerald-800 font-mono border border-emerald-200">
                              <Banknote size={11} className="text-emerald-600" />
                              {[
                                details.denominations.b10000 ? `10K: ${details.denominations.b10000}` : null,
                                details.denominations.b5000 ? `5K: ${details.denominations.b5000}` : null,
                                details.denominations.b2000 ? `2K: ${details.denominations.b2000}` : null,
                                details.denominations.b1000 ? `1K: ${details.denominations.b1000}` : null,
                                details.denominations.b500 ? `500: ${details.denominations.b500}` : null,
                              ]
                                .filter(Boolean)
                                .slice(0, 3)
                                .join(' · ')}
                            </span>
                          )}
                          {details?.note && (
                            <span className="italic text-gray-500">({details.note})</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                        <div className="text-right">
                          <span className="text-sm font-black text-emerald-600 font-mono block">
                            +{formatMoney(op.amount)} FCFA
                          </span>
                          <span className="text-[10px] text-red-500 font-mono">
                            Débit Caisse : -{formatMoney(op.amount)} F
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => setSelectedDepositReceipt(op)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 hover:border-[#D39725] hover:bg-amber-50 text-[#192A24] text-xs font-bold transition-all cursor-pointer"
                          title="Voir et imprimer le bordereau officiel"
                        >
                          <FileText size={14} className="text-[#D39725]" />
                          <span>Imprimer Bordereau</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </AppPanel>
        </div>
      )}

      {/* Tab 6: Entrées & Sorties par Période (Mois, Trimestre, Semestre, Annuel) */}
      {activeTab === 'flux_periodes' && canFlux && (
        <div className="space-y-6">
          {/* Header & Period Controls */}
          <AppPanel className="space-y-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#E8D8BE] pb-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-[#192A24] text-[#F2BD45] flex items-center justify-center shrink-0 shadow-xs">
                  <BarChart3 size={22} />
                </div>
                <div>
                  <h2 className="text-base font-black text-[#192A24] tracking-tight">
                    Flux de Trésorerie Caisse · Entrées & Sorties
                  </h2>
                  <p className="text-xs text-[#7D8176] mt-0.5">
                    Consolidation périodique des flux physiques en espèces : Mois, Trimestre, Semestre et Annuel.
                  </p>
                </div>
              </div>

              {/* Solde Caisse Actuel hidden by design */}
              {false && (
                <div className="flex items-center gap-3 bg-[#FAF8F3] px-4 py-2.5 rounded-xl border border-[#E8D8BE]">
                  <Wallet size={18} className="text-[#966308]" />
                  <div>
                    <div className="text-[10px] uppercase font-bold text-[#7D8176]">Solde Actuel Caisse</div>
                    <div className="text-base font-black font-mono text-[#192A24]">
                      {formatMoney(currentCashBalance)} <span className="text-xs text-gray-500 font-bold">FCFA</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Period Mode Selector */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              {/* Granularity Switcher: Mois / Trimestre / Semestre / Annuel */}
              <div className="flex flex-wrap items-center gap-1.5 p-1 bg-gray-100 rounded-xl">
                {[
                  { mode: 'month' as const, label: 'Mois (Mensuel)', icon: <Calendar size={14} /> },
                  { mode: 'quarter' as const, label: 'Trimestre', icon: <Layers size={14} /> },
                  { mode: 'semester' as const, label: 'Semestre', icon: <PieChart size={14} /> },
                  { mode: 'year' as const, label: 'Annuel', icon: <BarChart3 size={14} /> },
                ].map((item) => (
                  <button
                    key={item.mode}
                    type="button"
                    onClick={() => setPeriodMode(item.mode)}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      periodMode === item.mode
                        ? 'bg-white text-[#192A24] shadow-xs'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>

              {/* Year Selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[#7D8176]">Année :</span>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                  className="px-3 py-1.5 bg-[#FAF8F3] border border-[#E8D8BE] rounded-lg text-xs font-black text-[#192A24] cursor-pointer"
                >
                  {[2027, 2026, 2025, 2024].map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>

                {/* Quick Presets */}
                <div className="flex items-center gap-1 ml-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPeriodMode('month');
                      setSelectedYear(currentYear);
                      setSelectedMonth(currentMonth);
                    }}
                    className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-gray-100 hover:bg-[#FAF8F3] text-gray-700 border border-gray-200 cursor-pointer"
                  >
                    Ce Mois
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPeriodMode('quarter');
                      setSelectedYear(currentYear);
                      setSelectedQuarter(currentQuarter);
                    }}
                    className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-gray-100 hover:bg-[#FAF8F3] text-gray-700 border border-gray-200 cursor-pointer"
                  >
                    Ce Trimestre
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPeriodMode('semester');
                      setSelectedYear(currentYear);
                      setSelectedSemester(currentSemester);
                    }}
                    className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-gray-100 hover:bg-[#FAF8F3] text-gray-700 border border-gray-200 cursor-pointer"
                  >
                    Ce Semestre
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPeriodMode('year');
                      setSelectedYear(currentYear);
                    }}
                    className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-gray-100 hover:bg-[#FAF8F3] text-gray-700 border border-gray-200 cursor-pointer"
                  >
                    Année {currentYear}
                  </button>
                </div>
              </div>
            </div>

            {/* Granular Period Pickers */}
            <div className="pt-2">
              {/* If Month mode: Show 12 month buttons */}
              {periodMode === 'month' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                  {MONTH_NAMES_FR.map((name, idx) => {
                    const isSelected = selectedMonth === idx;
                    const isCurrent = currentMonth === idx && currentYear === selectedYear;
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setSelectedMonth(idx)}
                        className={`p-2 rounded-xl text-xs font-bold transition-all text-center cursor-pointer border ${
                          isSelected
                            ? 'bg-[#192A24] text-white border-[#192A24] shadow-xs'
                            : 'bg-white hover:bg-gray-50 text-gray-700 border-gray-200'
                        }`}
                      >
                        <div className="truncate">{name}</div>
                        {isCurrent && (
                          <div
                            className={`text-[9px] font-normal uppercase tracking-wider mt-0.5 ${
                              isSelected ? 'text-[#F2BD45]' : 'text-emerald-600'
                            }`}
                          >
                            En cours
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* If Quarter mode: 4 Quarters */}
              {periodMode === 'quarter' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {QUARTER_NAMES_FR.map((q) => {
                    const isSelected = selectedQuarter === q.id;
                    const isCurrent = currentQuarter === q.id && currentYear === selectedYear;
                    return (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => setSelectedQuarter(q.id)}
                        className={`p-3.5 rounded-xl text-left border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#192A24] text-white border-[#192A24] shadow-md'
                            : 'bg-white hover:bg-gray-50 text-[#192A24] border-gray-200'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black">{q.short}</span>
                          {isCurrent && (
                            <span
                              className={`text-[9px] px-1.5 py-0.5 rounded font-black uppercase ${
                                isSelected ? 'bg-amber-400/20 text-[#F2BD45]' : 'bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              Actuel
                            </span>
                          )}
                        </div>
                        <div className={`text-xs mt-1 ${isSelected ? 'text-white/80' : 'text-gray-600'}`}>
                          {q.label}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* If Semester mode: 2 Semesters */}
              {periodMode === 'semester' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {SEMESTER_NAMES_FR.map((s) => {
                    const isSelected = selectedSemester === s.id;
                    const isCurrent = currentSemester === s.id && currentYear === selectedYear;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelectedSemester(s.id)}
                        className={`p-4 rounded-xl text-left border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#192A24] text-white border-[#192A24] shadow-md'
                            : 'bg-white hover:bg-gray-50 text-[#192A24] border-gray-200'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-black">{s.short}</span>
                          {isCurrent && (
                            <span
                              className={`text-[9px] px-1.5 py-0.5 rounded font-black uppercase ${
                                isSelected ? 'bg-amber-400/20 text-[#F2BD45]' : 'bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              Semestre Actuel
                            </span>
                          )}
                        </div>
                        <div className={`text-xs mt-1 font-semibold ${isSelected ? 'text-white/80' : 'text-gray-600'}`}>
                          {s.label}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* If Year mode */}
              {periodMode === 'year' && (
                <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-[#966308] font-bold">
                    <Calendar size={16} />
                    <span>Bilan complet des 12 mois de l'année civile {selectedYear}</span>
                  </div>
                  <span className="font-mono text-[11px] text-[#192A24] font-bold">
                    {filteredCaisseFlows.length} mouvement(s) recensé(s)
                  </span>
                </div>
              )}
            </div>
          </AppPanel>

          {/* Headline Period KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Total Inflows */}
            <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-900 to-emerald-950 text-white shadow-md relative overflow-hidden">
              <div className="flex items-center justify-between text-xs">
                <span className="uppercase font-bold text-emerald-300 tracking-wider">
                  Total Entrées Caisse
                </span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-800/80 text-[10px] font-bold">
                  {periodInflows.length} flux
                </span>
              </div>
              <div className="text-2xl sm:text-3xl font-black font-mono text-emerald-300 mt-2">
                +{formatMoney(totalInflowsXaf)} <span className="text-xs font-bold text-white/70">FCFA</span>
              </div>
              <p className="text-[11px] text-white/60 mt-1">
                Recettes ventes or et approvisionnements entrants sur {periodLabel}
              </p>
            </div>

            {/* Total Outflows */}
            <div className="p-5 rounded-2xl bg-gradient-to-br from-rose-900 to-rose-950 text-white shadow-md relative overflow-hidden">
              <div className="flex items-center justify-between text-xs">
                <span className="uppercase font-bold text-rose-300 tracking-wider">
                  Total Sorties Caisse
                </span>
                <span className="px-2 py-0.5 rounded-full bg-rose-800/80 text-[10px] font-bold">
                  {periodOutflows.length} flux
                </span>
              </div>
              <div className="text-2xl sm:text-3xl font-black font-mono text-rose-300 mt-2">
                -{formatMoney(totalOutflowsXaf)} <span className="text-xs font-bold text-white/70">FCFA</span>
              </div>
              <p className="text-[11px] text-white/60 mt-1">
                Achats or espèces, versements banques, dépenses et virements clients
              </p>
            </div>

            {/* Net Period Balance */}
            <div className="p-5 rounded-2xl bg-[#192A24] text-white shadow-md relative overflow-hidden">
              <div className="flex items-center justify-between text-xs">
                <span className="uppercase font-bold text-[#F2BD45] tracking-wider">
                  Flux Net Périodique
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                    netFlowXaf >= 0
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-rose-500/20 text-rose-300'
                  }`}
                >
                  {netFlowXaf >= 0 ? 'Excédent' : 'Déficit'}
                </span>
              </div>
              <div
                className={`text-2xl sm:text-3xl font-black font-mono mt-2 ${
                  netFlowXaf >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {netFlowXaf >= 0 ? '+' : ''}
                {formatMoney(netFlowXaf)} <span className="text-xs font-bold text-white/70">FCFA</span>
              </div>
              <p className="text-[11px] text-white/60 mt-1">
                Variation nette de la caisse espèces pour {periodLabel}
              </p>
            </div>
          </div>

          {/* Visual Ratio Gauge */}
          {(totalInflowsXaf > 0 || totalOutflowsXaf > 0) && (
            <div className="bg-white p-4 rounded-2xl border border-[#E8D8BE] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-[#192A24]">
                  Équilibre des flux de la période ({periodLabel})
                </span>
                <span className="text-[11px] text-gray-500 font-mono">
                  Volume total mouvementé : {formatMoney(totalInflowsXaf + totalOutflowsXaf)} FCFA
                </span>
              </div>
              {(() => {
                const totalVol = totalInflowsXaf + totalOutflowsXaf;
                const inPercent = totalVol > 0 ? Math.round((totalInflowsXaf / totalVol) * 100) : 50;
                const outPercent = 100 - inPercent;
                return (
                  <div className="space-y-1">
                    <div className="w-full h-3.5 bg-gray-100 rounded-full overflow-hidden flex">
                      <div
                        style={{ width: `${inPercent}%` }}
                        className="bg-emerald-600 h-full transition-all duration-500"
                        title={`Entrées : ${inPercent}%`}
                      />
                      <div
                        style={{ width: `${outPercent}%` }}
                        className="bg-rose-500 h-full transition-all duration-500"
                        title={`Sorties : ${outPercent}%`}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-bold">
                      <span className="text-emerald-700">Entrées : {inPercent}%</span>
                      <span className="text-rose-600">Sorties : {outPercent}%</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Category Breakdown (2 columns) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Inflows breakdown */}
            <AppPanel>
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-gray-100">
                <SectionHeading
                  title="Détail des Entrées"
                  icon={<ArrowDownLeft size={18} className="text-emerald-600" />}
                />
                <span className="text-xs font-black font-mono text-emerald-600">
                  +{formatMoney(totalInflowsXaf)} F
                </span>
              </div>

              {Object.keys(inflowsByCategory).length === 0 ? (
                <p className="text-xs text-gray-400 py-6 text-center">Aucune entrée pour {periodLabel}.</p>
              ) : (
                <div className="space-y-2.5">
                  {Object.entries(inflowsByCategory).map(([cat, amt]) => {
                    const pct = totalInflowsXaf > 0 ? Math.round((amt / totalInflowsXaf) * 100) : 0;
                    return (
                      <div key={cat} className="p-3 rounded-xl bg-emerald-50/50 border border-emerald-100 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-[#192A24]">{cat}</span>
                          <span className="font-mono font-black text-emerald-700">+{formatMoney(amt)} FCFA</span>
                        </div>
                        <div className="w-full bg-emerald-100 h-1.5 rounded-full mt-2 overflow-hidden">
                          <div style={{ width: `${pct}%` }} className="bg-emerald-600 h-full" />
                        </div>
                        <div className="text-[10px] text-gray-500 mt-1">{pct}% du total des entrées</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </AppPanel>

            {/* Outflows breakdown */}
            <AppPanel>
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-gray-100">
                <SectionHeading
                  title="Détail des Sorties"
                  icon={<ArrowUpRight size={18} className="text-rose-600" />}
                />
                <span className="text-xs font-black font-mono text-rose-600">
                  -{formatMoney(totalOutflowsXaf)} F
                </span>
              </div>

              {Object.keys(outflowsByCategory).length === 0 ? (
                <p className="text-xs text-gray-400 py-6 text-center">Aucune sortie pour {periodLabel}.</p>
              ) : (
                <div className="space-y-2.5">
                  {Object.entries(outflowsByCategory).map(([cat, amt]) => {
                    const pct = totalOutflowsXaf > 0 ? Math.round((amt / totalOutflowsXaf) * 100) : 0;
                    return (
                      <div key={cat} className="p-3 rounded-xl bg-rose-50/50 border border-rose-100 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-[#192A24]">{cat}</span>
                          <span className="font-mono font-black text-rose-700">-{formatMoney(amt)} FCFA</span>
                        </div>
                        <div className="w-full bg-rose-100 h-1.5 rounded-full mt-2 overflow-hidden">
                          <div style={{ width: `${pct}%` }} className="bg-rose-500 h-full" />
                        </div>
                        <div className="text-[10px] text-gray-500 mt-1">{pct}% du total des sorties</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </AppPanel>
          </div>

          {/* Detailed Period Movements Journal */}
          <AppPanel>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 mb-4 border-b border-[#E8D8BE]">
              <div className="flex items-center gap-2">
                <SectionHeading
                  title={`Journal des mouvements de caisse · ${periodLabel}`}
                  icon={<Receipt size={18} />}
                />
              </div>

              {/* Filter Pills & Print */}
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-lg p-0.5 bg-gray-100 text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => setOperationsTypeFilter('ALL')}
                    className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                      operationsTypeFilter === 'ALL'
                        ? 'bg-[#192A24] text-white shadow-xs'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    Tous ({filteredCaisseFlows.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setOperationsTypeFilter('IN')}
                    className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                      operationsTypeFilter === 'IN'
                        ? 'bg-emerald-700 text-white shadow-xs'
                        : 'text-emerald-700 hover:text-emerald-900'
                    }`}
                  >
                    Entrées ({periodInflows.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setOperationsTypeFilter('OUT')}
                    className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                      operationsTypeFilter === 'OUT'
                        ? 'bg-rose-700 text-white shadow-xs'
                        : 'text-rose-700 hover:text-rose-900'
                    }`}
                  >
                    Sorties ({periodOutflows.length})
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E8D8BE] text-xs font-bold text-[#192A24] hover:bg-[#FAF8F3] transition-colors cursor-pointer"
                  title="Imprimer le relevé périodique"
                >
                  <Printer size={14} />
                  <span className="hidden sm:inline">Imprimer relevé</span>
                </button>
              </div>
            </div>

            {displayedFlows.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-500">
                Aucun mouvement de caisse ne correspond à ces critères pour {periodLabel}.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {displayedFlows.map((flow) => {
                  const isIncoming = flow.direction === 'IN';
                  return (
                    <div
                      key={flow.id}
                      className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs hover:bg-[#FAF8F3]/60 px-2 rounded-xl transition-colors"
                    >
                      <div className="flex items-start sm:items-center gap-3">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 sm:mt-0 ${
                            isIncoming
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-rose-100 text-rose-700'
                          }`}
                        >
                          {isIncoming ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
                        </div>

                        <div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase ${
                                isIncoming
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                  : 'bg-rose-50 text-rose-800 border border-rose-200'
                              }`}
                            >
                              {flow.category}
                            </span>
                            <span className="font-bold text-[#192A24]">{flow.title}</span>
                          </div>
                          <div className="text-[11px] text-[#7D8176] mt-0.5">
                            {flow.subtitle} · <span className="font-mono">{flow.displayDate}</span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right pl-10 sm:pl-0 shrink-0">
                        <span
                          className={`font-black font-mono text-sm block ${
                            isIncoming ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {isIncoming ? '+' : '-'}
                          {formatMoney(flow.amount)} FCFA
                        </span>
                        <span className="text-[10px] text-gray-400 font-mono">
                          {isIncoming ? 'Crédit Caisse' : 'Débit Caisse'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </AppPanel>
        </div>
      )}

      {/* Printable Bordereau Modal for Cash to Bank Deposits (Official Reference Model) */}
      {selectedDepositReceipt && (
        <OfficialBankDepositSlipModal
          isOpen={Boolean(selectedDepositReceipt)}
          onClose={() => setSelectedDepositReceipt(null)}
          operation={selectedDepositReceipt}
          initialBank={selectedDepositReceipt.depositDetails?.targetBank || 'Crédit du Congo'}
          initialAmount={selectedDepositReceipt.amount}
          initialDepositor={
            selectedDepositReceipt.depositDetails?.depositedBy ||
            selectedDepositReceipt.depositor ||
            store.userName
          }
          initialDate={selectedDepositReceipt.depositDetails?.date || selectedDepositReceipt.date}
          initialSlipRef={selectedDepositReceipt.depositDetails?.slipNumber}
          initialProvenance={
            selectedDepositReceipt.depositDetails?.note ||
            selectedDepositReceipt.subtitle ||
            'Recettes de vente d\'or'
          }
        />
      )}

      {/* Receipt Modal for Client Transfers */}
      {receiptEntry && (
        <Modal
          isOpen={Boolean(receiptEntry)}
          onClose={() => setReceiptEntry(null)}
          title="Bordereau officiel de virement client"
          maxWidth="max-w-xl"
        >
          <div className="space-y-5 print:p-0">
            {/* Printable Bordereau Container */}
            <div className="p-6 bg-[#FFFDFA] border-2 border-[#192A24] rounded-2xl space-y-5 text-[#192A24]">
              {/* Header */}
              <div className="flex items-center justify-between border-b-2 border-[#192A24] pb-4">
                <div>
                  <div className="text-lg font-black tracking-tight text-[#192A24]">CAMS GOLD</div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-[#D39725]">Comptoir d'Achat & Vente d'Or</div>
                </div>
                <div className="text-right">
                  <span className="px-2.5 py-1 rounded-md bg-emerald-100 text-emerald-900 text-[10px] font-black uppercase tracking-wider">
                    Virement Exécuté
                  </span>
                  <div className="text-[10px] text-gray-500 font-mono mt-1">Réf : {receiptEntry.id}</div>
                </div>
              </div>

              {/* Body */}
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-3 bg-gray-50 p-3 rounded-xl border border-gray-200">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-gray-500 block">Compte Débiteur (Émetteur)</span>
                    <strong className="text-sm font-black text-[#192A24]">
                      {receiptEntry.clientTransferDetails?.fromAccount || 'Compte Comptoir'}
                    </strong>
                    <div className="text-[10px] text-gray-500">Cams Gold Sarl</div>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-bold text-gray-500 block">Client Bénéficiaire</span>
                    <strong className="text-sm font-black text-emerald-800">
                      {receiptEntry.clientTransferDetails?.clientName || receiptEntry.title.replace('Virement client · ', '')}
                    </strong>
                    <div className="text-[11px] text-gray-600 font-semibold">
                      {receiptEntry.clientTransferDetails?.clientBank || 'Banque Client'}
                    </div>
                    {receiptEntry.clientTransferDetails?.clientAccountNumber && (
                      <div className="text-[10px] font-mono text-gray-600">
                        N° Compte / RIB : <strong>{receiptEntry.clientTransferDetails.clientAccountNumber}</strong>
                      </div>
                    )}
                    {receiptEntry.clientTransferDetails?.clientBankAgency && (
                      <div className="text-[10px] text-gray-600">
                        Agence : <strong>{receiptEntry.clientTransferDetails.clientBankAgency}</strong>
                      </div>
                    )}
                    {receiptEntry.clientTransferDetails?.clientAccountHolder && (
                      <div className="text-[10px] text-gray-600">
                        Titulaire : <strong>{receiptEntry.clientTransferDetails.clientAccountHolder}</strong>
                      </div>
                    )}
                    {receiptEntry.clientTransferDetails?.clientBankReference && (
                      <div className="text-[10px] font-mono text-gray-600">
                        Référence bancaire : <strong>{receiptEntry.clientTransferDetails.clientBankReference}</strong>
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-gradient-to-r from-[#192A24] to-[#253D34] text-white flex items-center justify-between">
                  <div>
                    <div className="text-[10px] uppercase font-bold text-[#F2BD45]">Montant total du virement</div>
                    <div className="text-2xl font-black font-mono mt-0.5">
                      {formatMoney(receiptEntry.amount)} <span className="text-sm">FCFA</span>
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-white/80">
                    <div>Date : {receiptEntry.date}</div>
                    {receiptEntry.clientTransferDetails?.feeAmount ? (
                      <div className="text-[10px] text-emerald-300">
                        Dont frais : {formatMoney(receiptEntry.clientTransferDetails.feeAmount)} F
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                  <span className="text-[10px] uppercase font-bold text-gray-500 block">Motif du virement</span>
                  <div className="font-semibold text-xs text-[#192A24]">
                    {receiptEntry.clientTransferDetails?.reason || receiptEntry.subtitle}
                  </div>
                </div>
              </div>

              {/* Signatures */}
              <div className="grid grid-cols-2 gap-6 pt-4 border-t border-dashed border-gray-300 text-[11px]">
                <div className="text-center space-y-8">
                  <span className="font-bold text-gray-500 block">Signature de l'Émetteur (Comptoir)</span>
                  <div className="border-t border-gray-400 w-3/4 mx-auto pt-1 font-mono text-[10px] text-gray-400">
                    Visa Comptoir
                  </div>
                </div>
                <div className="text-center space-y-8">
                  <span className="font-bold text-gray-500 block">Signature / Décharge Client</span>
                  <div className="border-t border-gray-400 w-3/4 mx-auto pt-1 font-mono text-[10px] text-gray-400">
                    Bénéficiaire
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 print:hidden">
              <button
                type="button"
                onClick={() => setReceiptEntry(null)}
                className="px-4 py-2 rounded-xl border border-gray-300 text-xs font-bold text-gray-600 hover:bg-gray-100 cursor-pointer"
              >
                Fermer
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#008B62] hover:bg-[#007452] text-white text-xs font-black cursor-pointer shadow-md"
              >
                <Printer size={15} />
                <span>Imprimer le bordereau</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal Modification d'une opération */}
      {editingOp && (
        <Modal
          isOpen={Boolean(editingOp)}
          onClose={() => setEditingOp(null)}
          title={`Modifier l'opération : ${editingOp.title}`}
          maxWidth="max-w-lg"
        >
          <form onSubmit={handleSaveEditOp} className="space-y-4">
            {editSuccess && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 flex items-center gap-2">
                <CheckCircle2 size={16} />
                <span>{editSuccess}</span>
              </div>
            )}

            {editError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-bold text-red-700 flex items-center gap-2">
                <AlertCircle size={16} />
                <span>{editError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-[#192A24] mb-1">
                Libellé / Titre de l'opération *
              </label>
              <input
                type="text"
                required
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full px-3.5 py-2 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs font-bold text-[#192A24]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#192A24] mb-1">
                Tiers / Sous-titre / Compte *
              </label>
              <input
                type="text"
                required
                value={editSubtitle}
                onChange={(e) => setEditSubtitle(e.target.value)}
                className="w-full px-3.5 py-2 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs text-[#192A24]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-[#192A24] mb-1">Montant (FCFA) *</label>
                <input
                  type="text"
                  required
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-sm font-black text-[#192A24]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#192A24] mb-1">Date</label>
                <input
                  type="text"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#192A24] mb-1">Notes internes / Motif</label>
              <textarea
                rows={2}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Précisions sur la modification..."
                className="w-full px-3.5 py-2 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setEditingOp(null)}
                className="px-4 py-2 rounded-xl border border-gray-300 text-xs font-bold text-gray-600 hover:bg-gray-100 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-[#192A24] hover:bg-[#253D34] text-white text-xs font-black shadow-md cursor-pointer flex items-center gap-1.5"
              >
                <CheckCircle2 size={15} />
                <span>Enregistrer les modifications</span>
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal Impression Rapport de la Caisse */}
      {isCaisseReportPrintOpen && (
        <Modal
          isOpen={isCaisseReportPrintOpen}
          onClose={() => setIsCaisseReportPrintOpen(false)}
          title="Rapport de la caisse"
          maxWidth="max-w-4xl"
          printMode={true}
        >
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b-2 border-[#192A24] pb-4">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-[#AA6B0B]">
                  CAMSGOLD · Trésorerie
                </div>
                <h2 className="text-xl font-bold text-[#192A24]">Rapport de la caisse</h2>
                <div className="text-xs text-[#7D8176] mt-0.5">
                  Compte : <strong className="text-[#192A24]">{caisseSourceAccount}</strong>
                  {apercuLedger.hasContactFilter ? (
                    <>
                      {' · '}Contact : <strong className="text-[#192A24]">{caisseContact.trim()}</strong>
                    </>
                  ) : null}
                  {' · '}Édité le {formatDateTime(new Date())}
                </div>
              </div>
              <div className="text-left sm:text-right">
                <div className="text-[11px] text-[#7D8176]">Solde actuel du compte</div>
                <div className="text-lg font-mono tabular-nums font-bold text-[#192A24]">
                  {formatMoney(store.bankBalances[caisseSourceAccount] ?? 0)} FCFA
                </div>
              </div>
            </div>

            {/* Synthèse */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#FAF8F3] border border-[#E8D8BE] rounded-xl p-4">
              <div>
                <div className="text-[11px] text-[#7D8176]">Total Dépôts</div>
                <div className="text-sm font-mono tabular-nums font-bold text-emerald-700">
                  +{formatMoney(apercuLedger.totalDepot)} FCFA
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#7D8176]">Total Retraits</div>
                <div className="text-sm font-mono tabular-nums font-bold text-red-700">
                  -{formatMoney(apercuLedger.totalRetrait)} FCFA
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#7D8176]">Dont Dépenses OPEX</div>
                <div className="text-sm font-mono tabular-nums font-bold text-[#192A24]">
                  {formatMoney(apercuLedger.totalOpex)} FCFA
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#7D8176]">Net (Dépôt − Retrait)</div>
                <div
                  className={`text-sm font-mono tabular-nums font-bold ${
                    apercuLedger.netBalance < 0 ? 'text-red-700' : 'text-emerald-700'
                  }`}
                >
                  {apercuLedger.netBalance >= 0 ? '+' : ''}
                  {formatMoney(apercuLedger.netBalance)} FCFA
                </div>
              </div>
            </div>

            {/* Tableau Compte en T complet */}
            <div className="border border-[#E8D8BE] rounded-xl overflow-hidden">
              <div className="grid grid-cols-2 border-b border-[#E8D8BE] bg-[#FAF8F3] text-xs font-bold text-[#192A24]">
                <div className="py-2.5 px-3 border-r border-[#E8D8BE] flex items-center justify-between">
                  <span>Dépôt ({apercuLedger.deposits.length})</span>
                  <span className="font-mono tabular-nums text-emerald-700">
                    +{formatMoney(apercuLedger.totalDepot)} F
                  </span>
                </div>
                <div className="py-2.5 px-3 flex items-center justify-between">
                  <span>Retrait ({apercuLedger.withdrawals.length})</span>
                  <span className="font-mono tabular-nums text-red-700">
                    -{formatMoney(apercuLedger.totalRetrait)} F
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2">
                <div className="border-r border-[#E8D8BE] divide-y divide-[#F3EBDC]">
                  {apercuLedger.deposits.length === 0 ? (
                    <div className="p-4 text-xs text-[#7D8176] text-center">Aucun dépôt</div>
                  ) : (
                    apercuLedger.deposits.map(({ op, contact, motif }) => (
                      <div key={op.id} className="p-2.5 flex items-baseline justify-between gap-2 text-xs">
                        <div className="min-w-0">
                          <div className="font-semibold text-[#192A24] truncate">{contact}</div>
                          <div className="text-[11px] text-[#7D8176] truncate">
                            {op.date} · {motif}
                          </div>
                        </div>
                        <span className="font-mono tabular-nums font-bold text-emerald-700 shrink-0">
                          +{formatMoney(op.amount)}
                        </span>
                      </div>
                    ))
                  )}
                </div>

                <div className="divide-y divide-[#F3EBDC]">
                  {apercuLedger.withdrawals.length === 0 ? (
                    <div className="p-4 text-xs text-[#7D8176] text-center">Aucun retrait</div>
                  ) : (
                    apercuLedger.withdrawals.map(({ op, contact, motif, isOpex }) => (
                      <div key={op.id} className="p-2.5 flex items-baseline justify-between gap-2 text-xs">
                        <div className="min-w-0">
                          <div className="font-semibold text-[#192A24] truncate">
                            {isOpex ? `OPEX · ${contact}` : contact}
                          </div>
                          <div className="text-[11px] text-[#7D8176] truncate">
                            {op.date} · {motif}
                          </div>
                        </div>
                        <span className="font-mono tabular-nums font-bold text-red-700 shrink-0">
                          -{formatMoney(op.amount)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100 print:hidden">
              <button
                type="button"
                onClick={() => setIsCaisseReportPrintOpen(false)}
                className="px-4 py-2 rounded-xl border border-gray-300 text-xs font-bold text-gray-600 hover:bg-gray-100 cursor-pointer"
              >
                Fermer
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#192A24] hover:bg-[#253D34] text-white text-xs font-bold cursor-pointer"
              >
                <Printer size={15} />
                <span>Imprimer le rapport</span>
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
