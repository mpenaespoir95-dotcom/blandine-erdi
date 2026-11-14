import { getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

initializeApp();

const accessToken = defineSecret('WHATSAPP_ACCESS_TOKEN');
const phoneNumberId = defineSecret('WHATSAPP_PHONE_NUMBER_ID');
const graphApiVersion = defineString('WHATSAPP_GRAPH_API_VERSION');
const templateName = defineString('WHATSAPP_TEMPLATE_NAME', {
  default: 'gold_purchase_slip',
});
const templateLanguage = defineString('WHATSAPP_TEMPLATE_LANGUAGE', {
  default: 'fr',
});
const recipientPhone = '242068461531';
const allowedRoles = new Set(['ADMIN', 'CASHIER', 'BUYER']);

interface PurchasePayment {
  amount: number;
  paidAt: string;
  method: string;
  note?: string;
  account?: string;
}

interface PurchaseSlip {
  id: string;
  reference: string;
  description: string;
  amount: number;
  purchasedAt: string;
  supplier?: string;
  grossWeightGrams?: number;
  nonGoldWeightGrams?: number;
  netWeightGrams?: number;
  karat?: string;
  goldCategory: string;
  referencePricePerGram?: number;
  payments: PurchasePayment[];
}

const db = getFirestore(getApp(), 'ai-studio-camsgold-aac9e856-fac5-4a8d-a74b-c1a7ca9769a8');

const formatMoney = (amount: number): string =>
  `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
    .format(Math.round(amount || 0))
    .replace(/[\u202F\u00A0]/g, ' ')} FCFA`;

const formatWeight = (weight: number, decimals = 2): string =>
  `${new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
    .format(weight || 0)
    .replace(/[\u202F\u00A0]/g, ' ')} g`;

const formatDate = (date: string): string => {
  const parsedDate = new Date(date);
  return Number.isNaN(parsedDate.getTime())
    ? 'Date non disponible'
    : new Intl.DateTimeFormat('fr-FR', {
        dateStyle: 'long',
        timeZone: 'Africa/Brazzaville',
      }).format(parsedDate);
};

const formatDateTime = (date: string): string => {
  const parsedDate = new Date(date);
  return Number.isNaN(parsedDate.getTime())
    ? date
    : new Intl.DateTimeFormat('fr-FR', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Africa/Brazzaville',
      }).format(parsedDate);
};

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;

// Convert UTF-8 JS string to WinAnsi byte codes wrapped in a PDF literal string
const WINANSI_MAP: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

const toPdfWinAnsiBytes = (input: string): string => {
  const normalized = input.replace(/[\u202F\u00A0]/g, ' ');
  let out = '(';
  for (let i = 0; i < normalized.length; i += 1) {
    const code = normalized.charCodeAt(i);
    let byte = 0x3f; // '?'
    if (code >= 0x20 && code <= 0xff) {
      byte = code;
    } else if (WINANSI_MAP[code] !== undefined) {
      byte = WINANSI_MAP[code];
    }
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) {
      out += `\\${String.fromCharCode(byte)}`;
    } else if (byte < 0x80) {
      out += String.fromCharCode(byte);
    } else {
      out += `\\${byte.toString(8).padStart(3, '0')}`;
    }
  }
  out += ')';
  return out;
};

const createPurchaseSlipPdf = (purchase: PurchaseSlip, operatorName: string): Buffer => {
  const mmToPt = 72 / 25.4;
  const pageWidthMm = 210;
  const pageHeightMm = 297;
  const pageWidthPt = pageWidthMm * mmToPt;
  const pageHeightPt = pageHeightMm * mmToPt;
  const margin = 14;
  const contentWidth = pageWidthMm - margin * 2;

  const ptX = (mm: number): string => (mm * mmToPt).toFixed(2);
  const ptY = (mm: number): string => ((pageHeightMm - mm) * mmToPt).toFixed(2);
  const ptW = (mm: number): string => (mm * mmToPt).toFixed(2);
  const ptH = (mm: number): string => (mm * mmToPt).toFixed(2);

  const ops: string[] = [];

  const setStrokeRgb = (r: number, g: number, b: number) => {
    ops.push(`${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)} RG`);
  };
  const setFillRgb = (r: number, g: number, b: number) => {
    ops.push(`${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)} rg`);
  };
  const drawRect = (
    x: number,
    yTop: number,
    w: number,
    h: number,
    mode: 'S' | 'F' | 'B',
    lineWidthMm = 0.3
  ) => {
    ops.push(`${(lineWidthMm * mmToPt).toFixed(2)} w`);
    ops.push(`${ptX(x)} ${ptY(yTop + h)} ${ptW(w)} ${ptH(h)} re ${mode}`);
  };
  const drawLine = (x1: number, y1: number, x2: number, y2: number, lineWidthMm = 0.3) => {
    ops.push(`${(lineWidthMm * mmToPt).toFixed(2)} w`);
    ops.push(`${ptX(x1)} ${ptY(y1)} m ${ptX(x2)} ${ptY(y2)} l S`);
  };
  const drawText = (
    value: string,
    x: number,
    yBaseline: number,
    opts: {
      size?: number;
      bold?: boolean;
      color?: [number, number, number];
      align?: 'left' | 'right' | 'center';
    } = {}
  ) => {
    const { size = 9, bold = false, color = [25, 42, 36], align = 'left' } = opts;
    const fontKey = bold ? '/F2' : '/F1';
    const approxWidthMm = (value.length * size * 0.48) / mmToPt;
    let drawX = x;
    if (align === 'right') drawX = x - approxWidthMm;
    else if (align === 'center') drawX = x - approxWidthMm / 2;

    ops.push('BT');
    ops.push(`${fontKey} ${size.toFixed(1)} Tf`);
    setFillRgb(color[0], color[1], color[2]);
    ops.push(`1 0 0 1 ${ptX(drawX)} ${ptY(yBaseline)} Tm`);
    ops.push(`${toPdfWinAnsiBytes(value)} Tj`);
    ops.push('ET');
  };

  const darkGreen: [number, number, number] = [25, 42, 36];
  const gold: [number, number, number] = [211, 151, 37];
  const emerald: [number, number, number] = [0, 139, 98];
  const muted: [number, number, number] = [102, 112, 133];

  // Outer & Inner Borders
  setStrokeRgb(...darkGreen);
  drawRect(margin - 4, margin - 4, contentWidth + 8, pageHeightMm - margin * 2 + 8, 'S', 0.8);
  setStrokeRgb(230, 230, 230);
  drawRect(margin - 2, margin - 2, contentWidth + 4, pageHeightMm - margin * 2 + 4, 'S', 0.2);

  let y = margin + 4;
  drawText('CAMS GOLD COMPTOIR', margin, y, { size: 17, bold: true, color: darkGreen });
  y += 5.5;
  drawText("ACHAT · ANALYSE · EXPORTATION D'OR & MÉTAUX PRÉCIEUX", margin, y, {
    size: 8.5,
    bold: true,
    color: gold,
  });
  y += 4.5;
  drawText('Bordereau Officiel de Pesée & Règlement au Comptoir', margin, y, {
    size: 8,
    color: muted,
  });

  // Right Reference Box
  const refLabel = `BON D'ACHAT N° ${purchase.reference}`;
  const refBoxW = Math.max(58, refLabel.length * 2.25 + 8);
  const refBoxX = pageWidthMm - margin - refBoxW;
  setFillRgb(...darkGreen);
  drawRect(refBoxX, margin, refBoxW, 7.5, 'F');
  drawText(refLabel, refBoxX + refBoxW / 2, margin + 5.1, {
    size: 9,
    bold: true,
    color: [255, 255, 255],
    align: 'center',
  });
  drawText(`Date d'opération : ${formatDate(purchase.purchasedAt)}`, pageWidthMm - margin, margin + 12, {
    size: 8,
    color: [60, 60, 60],
    align: 'right',
  });
  drawText(`Opérateur : ${truncate(operatorName || 'Comptoir CAMS GOLD', 36)}`, pageWidthMm - margin, margin + 16, {
    size: 8,
    color: [60, 60, 60],
    align: 'right',
  });

  y += 6;
  setStrokeRgb(...darkGreen);
  drawLine(margin, y, pageWidthMm - margin, y, 0.6);
  y += 5;

  // Section 1: Fournisseur
  setFillRgb(248, 249, 250);
  setStrokeRgb(220, 224, 230);
  drawRect(margin, y, contentWidth, 20, 'B', 0.3);
  drawText('FOURNISSEUR / VENDEUR', margin + 4, y + 5, { size: 7.5, bold: true, color: muted });
  drawText(truncate(purchase.supplier || 'Fournisseur particulier / Non renseigné', 50), margin + 4, y + 11, {
    size: 11.5,
    bold: true,
    color: darkGreen,
  });
  drawText(`Catégorie d'or : ${purchase.goldCategory || 'Or brut'}`, margin + 4, y + 16, {
    size: 8.5,
    bold: true,
    color: gold,
  });
  y += 24;

  // Section 2: Analyse physique
  setFillRgb(250, 248, 243);
  setStrokeRgb(232, 216, 190);
  drawRect(margin, y, contentWidth, 7, 'B', 0.3);
  drawText("DÉTAIL DE L'ANALYSE PHYSIQUE & PESÉE CERTIFIÉE", margin + 4, y + 4.8, {
    size: 8,
    bold: true,
    color: darkGreen,
  });
  y += 8;

  const gross = purchase.grossWeightGrams ?? purchase.netWeightGrams ?? 0;
  const nonGold = purchase.nonGoldWeightGrams ?? 0;
  const net = purchase.netWeightGrams ?? gross;
  const karat = purchase.karat || '24K';
  const karatNum = Number.parseFloat(karat.replace('K', '')) || 24;
  const fineGold = (net * karatNum) / 24;
  const pricePerGram = purchase.referencePricePerGram ?? 0;

  const cols: Array<{
    title: string;
    width: number;
    value: string;
    bold?: boolean;
    color?: [number, number, number];
    alignRight?: boolean;
  }> = [
    { title: 'POIDS BRUT', width: 28, value: formatWeight(gross, 2) },
    { title: 'TARE / DÉCHETS', width: 30, value: formatWeight(nonGold, 2) },
    { title: 'POIDS NET', width: 28, value: formatWeight(net, 2), bold: true },
    { title: 'TITRE CARAT', width: 26, value: karat, bold: true, color: gold },
    { title: 'POIDS FIN 24K', width: 32, value: formatWeight(fineGold, 3), bold: true },
    {
      title: 'PRIX NET / G',
      width: contentWidth - (28 + 30 + 28 + 26 + 32),
      value: formatMoney(pricePerGram),
      bold: true,
      color: emerald,
      alignRight: true,
    },
  ];

  setFillRgb(245, 247, 250);
  setStrokeRgb(220, 225, 230);
  drawRect(margin, y, contentWidth, 6, 'B', 0.25);
  let curX = margin;
  for (const col of cols) {
    drawText(col.title, col.alignRight ? curX + col.width - 3 : curX + 3, y + 4.2, {
      size: 7,
      bold: true,
      color: muted,
      align: col.alignRight ? 'right' : 'left',
    });
    curX += col.width;
  }
  y += 6;

  setFillRgb(255, 255, 255);
  setStrokeRgb(220, 225, 230);
  drawRect(margin, y, contentWidth, 8, 'B', 0.25);
  curX = margin;
  for (const col of cols) {
    drawText(col.value, col.alignRight ? curX + col.width - 3 : curX + 3, y + 5.5, {
      size: 8.8,
      bold: col.bold,
      color: col.color ?? darkGreen,
      align: col.alignRight ? 'right' : 'left',
    });
    curX += col.width;
  }
  y += 13;

  // Section 3: Situation du règlement
  const paidAmount = (purchase.payments || []).reduce((sum, p) => sum + p.amount, 0);
  const balance = purchase.amount - paidAmount;

  setFillRgb(248, 249, 250);
  setStrokeRgb(220, 224, 230);
  drawRect(margin, y, contentWidth, 26, 'B', 0.3);
  drawText('SITUATION DU RÈGLEMENT FINANCIER', margin + 4, y + 5, {
    size: 8,
    bold: true,
    color: muted,
  });

  const third = contentWidth / 3;
  drawText("MONTANT TOTAL DE L'ACHAT", margin + 4, y + 11, { size: 7.5, color: muted });
  drawText(formatMoney(purchase.amount), margin + 4, y + 17, {
    size: 12,
    bold: true,
    color: darkGreen,
  });

  drawText('DÉJÀ RÉGLÉ AU FOURNISSEUR', margin + third + 4, y + 11, { size: 7.5, color: muted });
  drawText(formatMoney(paidAmount), margin + third + 4, y + 17, {
    size: 12,
    bold: true,
    color: emerald,
  });

  const balanceLabel =
    balance > 0 ? 'RESTE À PAYER (DETTE)' : balance < 0 ? 'TROP-PERÇU' : 'SOLDE DU COMPTE';
  drawText(balanceLabel, margin + third * 2 + 4, y + 11, { size: 7.5, color: muted });
  drawText(formatMoney(Math.abs(balance)), margin + third * 2 + 4, y + 17, {
    size: 12,
    bold: true,
    color: balance > 0 ? [217, 119, 6] : emerald,
  });

  const statusLine =
    balance === 0
      ? 'Achat entièrement soldé : le fournisseur a perçu la totalité du règlement.'
      : balance > 0
      ? `Reste à verser au fournisseur : ${formatMoney(balance)}.`
      : `Le fournisseur a un trop-perçu de ${formatMoney(Math.abs(balance))}.`;
  drawText(statusLine, margin + 4, y + 22.5, { size: 7.5, color: [70, 70, 70] });
  y += 30;

  // Section 4: Modalités & Justificatifs
  drawText('MODALITÉS & JUSTIFICATIFS DE RÈGLEMENT', margin, y, {
    size: 8,
    bold: true,
    color: muted,
  });
  y += 3;

  const payments = purchase.payments || [];
  if (payments.length === 0) {
    setFillRgb(252, 252, 252);
    setStrokeRgb(230, 230, 230);
    drawRect(margin, y, contentWidth, 8, 'B', 0.25);
    drawText('Aucun versement enregistré immédiatement pour ce bon d’achat.', margin + 4, y + 5.2, {
      size: 7.5,
      color: muted,
    });
    y += 12;
  } else {
    for (let i = 0; i < Math.min(payments.length, 5); i += 1) {
      const p = payments[i];
      setFillRgb(255, 255, 255);
      setStrokeRgb(230, 235, 240);
      drawRect(margin, y, contentWidth, 9, 'B', 0.25);
      drawText(truncate(p.method || 'Règlement espèces', 24), margin + 3, y + 5.8, {
        size: 8.5,
        bold: true,
        color: darkGreen,
      });
      const detail = `Date : ${formatDateTime(p.paidAt)} · Compte : ${p.account || 'Caisse principale'}`;
      drawText(truncate(detail, 55), margin + 45, y + 5.8, { size: 7, color: muted });
      drawText(formatMoney(p.amount), pageWidthMm - margin - 3, y + 5.8, {
        size: 9,
        bold: true,
        color: emerald,
        align: 'right',
      });
      y += 10.5;
    }
  }

  y += 4;
  setStrokeRgb(220, 220, 220);
  drawLine(margin, y, pageWidthMm - margin, y, 0.3);
  y += 4;

  drawText(
    "* Le vendeur certifie sur l'honneur être le propriétaire légitime du lot d'or présenté et que ce dernier est exempt de tout gage.",
    margin,
    y,
    { size: 6.8, color: muted }
  );
  y += 3.5;
  drawText(
    "Ce bordereau tient lieu d'acte officiel d'achat et de décharge comptable délivré par CAMS GOLD COMPTOIR.",
    margin,
    y,
    { size: 6.8, color: muted }
  );
  y += 6;

  // Signatures
  const sigW = (contentWidth - 10) / 2;
  const sigH = 26;
  setStrokeRgb(180, 185, 190);
  ops.push('[3 3] 0 d');
  drawRect(margin, y, sigW, sigH, 'S', 0.3);
  drawRect(margin + sigW + 10, y, sigW, sigH, 'S', 0.3);
  ops.push('[] 0 d');

  drawText('Signature & Empreinte du Fournisseur', margin + sigW / 2, y + 5, {
    size: 7.5,
    bold: true,
    color: darkGreen,
    align: 'center',
  });
  drawText('« Lu et approuvé, bon pour accord »', margin + sigW / 2, y + 9, {
    size: 6.5,
    color: muted,
    align: 'center',
  });

  drawText('Visa, Cachet & Signature du Comptoir', margin + sigW + 10 + sigW / 2, y + 5, {
    size: 7.5,
    bold: true,
    color: darkGreen,
    align: 'center',
  });
  drawText('Le Peseur / Caissier habilité', margin + sigW + 10 + sigW / 2, y + 9, {
    size: 6.5,
    color: muted,
    align: 'center',
  });

  // Footer
  const footerY = pageHeightMm - margin + 2;
  drawText('CAMS GOLD COMPTOIR', margin, footerY, { size: 7, bold: true, color: gold });
  drawText('Destinataire WhatsApp : +242 06 846 15 31 · République du Congo', pageWidthMm - margin, footerY, {
    size: 7,
    color: muted,
    align: 'right',
  });

  // Assemble PDF 1.4 document
  const streamContent = ops.join('\n');
  const streamBytes = Buffer.byteLength(streamContent, 'latin1');

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidthPt.toFixed(2)} ${pageHeightPt.toFixed(2)}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj\n`,
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n',
    `6 0 obj\n<< /Length ${streamBytes} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
  ];

  const header = '%PDF-1.4\n';
  const chunks: string[] = [header];
  const offsets: number[] = [0];
  let currentOffset = Buffer.byteLength(header, 'latin1');

  for (const obj of objects) {
    offsets.push(currentOffset);
    chunks.push(obj);
    currentOffset += Buffer.byteLength(obj, 'latin1');
  }

  const xrefOffset = currentOffset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(xref, trailer);

  return Buffer.from(chunks.join(''), 'latin1');
};

const getApiError = async (response: Response): Promise<string> => {
  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;
  return payload?.error?.message || `Erreur API WhatsApp (${response.status}).`;
};

export const sendGoldPurchaseSlip = onCall(
  {
    region: 'us-central1',
    timeoutSeconds: 120,
    memory: '512MiB',
    secrets: [accessToken, phoneNumberId],
  },
  async (request) => {
    let stage = 'authentification';
    let purchaseId = 'inconnu';
    try {
      if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Connectez-vous pour envoyer le bordereau.');
      }
      if (request.auth.token.email_verified !== true) {
        throw new HttpsError('permission-denied', 'Le compte doit être vérifié.');
      }

      stage = 'vérification du profil';
      const profileSnapshot = await db.collection('users').doc(request.auth.uid).get();
      const profile = profileSnapshot.data();
      if (
        profileSnapshot.exists !== true ||
        profile?.active !== true ||
        typeof profile.role !== 'string' ||
        !allowedRoles.has(profile.role)
      ) {
        throw new HttpsError('permission-denied', 'Votre compte n’est pas autorisé à envoyer des achats.');
      }

      stage = 'lecture de l’achat';
      const requestedPurchaseId = request.data?.purchaseId;
      if (typeof requestedPurchaseId !== 'string' || !/^purch-[\w-]+$/.test(requestedPurchaseId)) {
        throw new HttpsError('invalid-argument', 'La référence interne de l’achat est invalide.');
      }
      purchaseId = requestedPurchaseId;

      const purchaseRef = db.collection('purchases').doc(purchaseId);
      const purchaseSnapshot = await purchaseRef.get();
      const purchase = purchaseSnapshot.data() as PurchaseSlip | undefined;
      if (
        !purchaseSnapshot.exists ||
        !purchase ||
        purchase.id !== purchaseId ||
        typeof purchase.reference !== 'string' ||
        typeof purchase.amount !== 'number' ||
        !Number.isFinite(purchase.amount) ||
        purchase.amount <= 0 ||
        !Array.isArray(purchase.payments)
      ) {
        throw new HttpsError('failed-precondition', 'L’achat doit être enregistré avant l’envoi du bordereau.');
      }

      stage = 'réservation de l’envoi';
      const deliveryRef = db.collection('whatsapp_purchase_slips').doc(purchase.id);
      const shouldSend = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(deliveryRef);
        if (snapshot.get('status') === 'sent') return false;
        const lastUpdate = Date.parse(snapshot.get('updatedAt') ?? '');
        if (
          snapshot.get('status') === 'sending' &&
          Number.isFinite(lastUpdate) &&
          Date.now() - lastUpdate < 3 * 60 * 1000
        ) {
          throw new HttpsError('aborted', 'L’envoi de ce bordereau est déjà en cours.');
        }
        transaction.set(
          deliveryRef,
          {
            purchaseId: purchase.id,
            reference: purchase.reference,
            recipient: recipientPhone,
            status: 'sending',
            attempts: (snapshot.get('attempts') ?? 0) + 1,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        return true;
      });
      if (!shouldSend) return { sent: true, alreadySent: true };

      try {
        stage = 'génération du PDF du bordereau';
        const version = graphApiVersion.value();
        if (!/^v\d+\.\d+$/.test(version)) {
          throw new Error('WHATSAPP_GRAPH_API_VERSION doit être au format vNN.N.');
        }

        const operatorName =
          typeof profile.name === 'string' && profile.name.trim()
            ? profile.name
            : 'CAMS GOLD';
        const pdfBuffer = createPurchaseSlipPdf(purchase, operatorName);
        const safeRef = (purchase.reference || 'bon-achat').replace(/[^a-zA-Z0-9_-]/g, '_');
        const filename = `Bordereau-Achat-CAMS-GOLD-${safeRef}.pdf`;
        const apiUrl = `https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId.value())}`;

        stage = 'envoi du PDF à WhatsApp';
        const mediaForm = new FormData();
        mediaForm.set('messaging_product', 'whatsapp');
        mediaForm.set('type', 'application/pdf');
        const pdfArrayBuffer = new ArrayBuffer(pdfBuffer.byteLength);
        new Uint8Array(pdfArrayBuffer).set(pdfBuffer);
        mediaForm.set(
          'file',
          new Blob([pdfArrayBuffer], { type: 'application/pdf' }),
          filename
        );

        const mediaResponse = await fetch(`${apiUrl}/media`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken.value()}` },
          body: mediaForm,
        });
        if (!mediaResponse.ok) throw new Error(await getApiError(mediaResponse));
        const media = (await mediaResponse.json()) as { id?: string };
        if (!media.id) throw new Error('WhatsApp n’a pas renvoyé l’identifiant du document PDF.');

        stage = 'envoi du message PDF WhatsApp';
        let messageResponse = await fetch(`${apiUrl}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken.value()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: recipientPhone,
            type: 'template',
            template: {
              name: templateName.value(),
              language: { code: templateLanguage.value() },
              components: [
                {
                  type: 'header',
                  parameters: [
                    {
                      type: 'document',
                      document: { id: media.id, filename },
                    },
                  ],
                },
                {
                  type: 'body',
                  parameters: [
                    { type: 'text', text: purchase.reference },
                    { type: 'text', text: purchase.supplier || 'Fournisseur inconnu' },
                    { type: 'text', text: formatMoney(purchase.amount) },
                  ],
                },
              ],
            },
          }),
        });

        // Fallback direct PDF document message if template uses another format or 24h window is active
        if (!messageResponse.ok) {
          messageResponse = await fetch(`${apiUrl}/messages`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken.value()}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: recipientPhone,
              type: 'document',
              document: {
                id: media.id,
                filename,
                caption: `CAMS GOLD COMPTOIR · Bon d'achat N° ${purchase.reference}\nFournisseur : ${purchase.supplier || 'Fournisseur particulier'}\nMontant : ${formatMoney(purchase.amount)}`,
              },
            }),
          });
        }

        if (!messageResponse.ok) throw new Error(await getApiError(messageResponse));
        const message = (await messageResponse.json()) as {
          messages?: Array<{ id?: string }>;
        };

        await deliveryRef.set(
          {
            status: 'sent',
            format: 'pdf',
            messageId: message.messages?.[0]?.id ?? null,
            sentAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            error: null,
          },
          { merge: true }
        );
        return { sent: true, format: 'pdf' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Erreur inconnue.';
        logger.error('Échec de l’envoi du bordereau PDF WhatsApp', {
          stage,
          purchaseId,
          error: message,
        });
        await deliveryRef.set(
          {
            status: 'failed',
            error: `${stage}: ${message}`,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        throw new HttpsError('internal', `Échec à l’étape « ${stage} » : ${message}`);
      }
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Erreur inconnue.';
      logger.error('Erreur serveur pendant l’envoi du bordereau PDF WhatsApp', {
        stage,
        purchaseId,
        error: message,
      });
      throw new HttpsError('internal', `Erreur à l’étape « ${stage} » : ${message}`);
    }
  }
);
