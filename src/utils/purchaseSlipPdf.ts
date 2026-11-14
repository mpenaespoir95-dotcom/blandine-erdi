import { jsPDF } from 'jspdf';
import { PurchaseRecord } from '../types';

export const RECIPIENT_WHATSAPP_PHONE = '242068461531';
export const RECIPIENT_WHATSAPP_DISPLAY = '+242 06 846 15 31';

const formatMoney = (val: number): string =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
    .format(Math.round(val || 0))
    .replace(/[\u202F\u00A0]/g, ' ');

const formatNumber = (val: number, decimals: number = 2): string =>
  new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
    .format(val || 0)
    .replace(/[\u202F\u00A0]/g, ' ');

const formatDate = (dateString?: string): string => {
  if (!dateString) return 'Date non renseignée';
  const d = new Date(dateString);
  return Number.isNaN(d.getTime())
    ? dateString
    : new Intl.DateTimeFormat('fr-FR', {
        dateStyle: 'long',
        timeZone: 'Africa/Brazzaville',
      }).format(d);
};

const formatDateTime = (dateString?: string): string => {
  if (!dateString) return '';
  const d = new Date(dateString);
  return Number.isNaN(d.getTime())
    ? dateString
    : new Intl.DateTimeFormat('fr-FR', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Africa/Brazzaville',
      }).format(d);
};

export const createPurchaseSlipPdfDocument = (
  purchase: PurchaseRecord,
  operatorName: string
): jsPDF => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  // Colors
  const darkGreen = [25, 42, 36]; // #192A24
  const gold = [211, 151, 37]; // #D39725
  const emerald = [0, 139, 98]; // #008B62
  const textMuted = [102, 112, 133]; // #667085
  const borderLight = [232, 216, 190]; // #E8D8BE
  const bgLight = [250, 248, 243]; // #FAF8F3

  // Outer Border
  doc.setDrawColor(darkGreen[0], darkGreen[1], darkGreen[2]);
  doc.setLineWidth(0.8);
  doc.rect(margin - 4, margin - 4, contentWidth + 8, pageHeight - margin * 2 + 8, 'S');

  // Inner subtle border
  doc.setDrawColor(230, 230, 230);
  doc.setLineWidth(0.2);
  doc.rect(margin - 2, margin - 2, contentWidth + 4, pageHeight - margin * 2 + 4, 'S');

  let y = margin + 4;

  // Header Left: Brand
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(darkGreen[0], darkGreen[1], darkGreen[2]);
  doc.text('CAMS GOLD COMPTOIR', margin, y);

  y += 5.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(gold[0], gold[1], gold[2]);
  doc.text("ACHAT · ANALYSE · EXPORTATION D'OR & MÉTAUX PRÉCIEUX", margin, y);

  y += 4.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text('Bordereau Officiel de Pesée & Règlement au Comptoir', margin, y);

  // Header Right: Reference Pill & Dates
  const refText = `BON D'ACHAT N° ${purchase.reference}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  const refWidth = doc.getTextWidth(refText) + 8;
  const refX = pageWidth - margin - refWidth;

  doc.setFillColor(darkGreen[0], darkGreen[1], darkGreen[2]);
  doc.roundedRect(refX, margin, refWidth, 7.5, 1.5, 1.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.text(refText, refX + 4, margin + 5.2);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(60, 60, 60);
  const dateText = `Date d'opération : ${formatDate(purchase.purchasedAt)}`;
  doc.text(dateText, pageWidth - margin, margin + 12, { align: 'right' });

  const opText = `Opérateur : ${operatorName || 'Comptoir CAMS GOLD'}`;
  doc.text(opText, pageWidth - margin, margin + 16, { align: 'right' });

  // Divider Line
  y += 6;
  doc.setDrawColor(darkGreen[0], darkGreen[1], darkGreen[2]);
  doc.setLineWidth(0.6);
  doc.line(margin, y, pageWidth - margin, y);

  y += 5;

  // Section 1: Fournisseur & Catégorie d'Or (Card)
  doc.setFillColor(248, 249, 250);
  doc.setDrawColor(220, 224, 230);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, contentWidth, 20, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text('FOURNISSEUR / VENDEUR', margin + 4, y + 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(darkGreen[0], darkGreen[1], darkGreen[2]);
  doc.text(purchase.supplier || 'Fournisseur particulier / Non renseigné', margin + 4, y + 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(70, 70, 70);
  doc.text("Catégorie d'or :", margin + 4, y + 16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(gold[0], gold[1], gold[2]);
  doc.text(purchase.goldCategory || 'Or brut', margin + 26, y + 16);

  // Reference contact if any
  if (purchase.description) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
    const desc = doc.splitTextToSize(purchase.description, contentWidth / 2);
    doc.text(desc[0] || '', pageWidth - margin - 4, y + 11, { align: 'right' });
  }

  y += 24;

  // Section 2: Analyse Physique & Pesée Certifiée (Table)
  doc.setFillColor(bgLight[0], bgLight[1], bgLight[2]);
  doc.setDrawColor(borderLight[0], borderLight[1], borderLight[2]);
  doc.roundedRect(margin, y, contentWidth, 7, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(darkGreen[0], darkGreen[1], darkGreen[2]);
  doc.text("DÉTAIL DE L'ANALYSE PHYSIQUE & PESÉE CERTIFIÉE", margin + 4, y + 4.8);

  y += 8;

  // Table header
  const gross = purchase.grossWeightGrams ?? purchase.netWeightGrams ?? 0;
  const nonGold = purchase.nonGoldWeightGrams ?? 0;
  const net = purchase.netWeightGrams ?? gross;
  const karat = purchase.karat || '24K';
  const karatNum = parseFloat(karat.replace('K', '')) || 24;
  const fineGold = (net * karatNum) / 24;
  const pricePerGram = purchase.referencePricePerGram || 0;

  const cols = [
    { title: 'POIDS BRUT', width: 28, value: `${formatNumber(gross, 2)} g` },
    { title: 'TARE / DÉCHETS', width: 30, value: `${formatNumber(nonGold, 2)} g` },
    { title: 'POIDS NET', width: 28, value: `${formatNumber(net, 2)} g`, bold: true },
    { title: 'TITRE CARAT', width: 26, value: karat, color: gold },
    { title: 'POIDS FIN 24K', width: 32, value: `${formatNumber(fineGold, 3)} g`, bold: true },
    {
      title: 'PRIX NET / G',
      width: contentWidth - (28 + 30 + 28 + 26 + 32),
      value: `${formatMoney(pricePerGram)} FCFA`,
      alignRight: true,
      color: emerald,
      bold: true,
    },
  ];

  // Header row
  doc.setFillColor(245, 247, 250);
  doc.setDrawColor(220, 225, 230);
  doc.rect(margin, y, contentWidth, 6, 'FD');

  let curX = margin;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  for (const c of cols) {
    if (c.alignRight) {
      doc.text(c.title, curX + c.width - 3, y + 4.2, { align: 'right' });
    } else {
      doc.text(c.title, curX + 3, y + 4.2);
    }
    curX += c.width;
  }

  y += 6;

  // Values row
  doc.setFillColor(255, 255, 255);
  doc.rect(margin, y, contentWidth, 8, 'FD');

  curX = margin;
  doc.setFontSize(9);
  for (const c of cols) {
    doc.setFont('helvetica', c.bold ? 'bold' : 'normal');
    if (c.color) {
      doc.setTextColor(c.color[0], c.color[1], c.color[2]);
    } else {
      doc.setTextColor(darkGreen[0], darkGreen[1], darkGreen[2]);
    }
    if (c.alignRight) {
      doc.text(c.value, curX + c.width - 3, y + 5.5, { align: 'right' });
    } else {
      doc.text(c.value, curX + 3, y + 5.5);
    }
    curX += c.width;
  }

  y += 13;

  // Section 3: Situation du Règlement
  const paidAmount = (purchase.payments || []).reduce((sum, p) => sum + p.amount, 0);
  const balance = purchase.amount - paidAmount;

  doc.setFillColor(248, 249, 250);
  doc.setDrawColor(220, 224, 230);
  doc.roundedRect(margin, y, contentWidth, 26, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text('SITUATION DU RÈGLEMENT FINANCIER', margin + 4, y + 5);

  const colWidth = contentWidth / 3;

  // Col 1: Montant Total
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text("MONTANT TOTAL DE L'ACHAT", margin + 4, y + 11);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(darkGreen[0], darkGreen[1], darkGreen[2]);
  doc.text(`${formatMoney(purchase.amount)} FCFA`, margin + 4, y + 17);

  // Col 2: Déjà réglé
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text('DÉJÀ RÉGLÉ AU FOURNISSEUR', margin + colWidth + 4, y + 11);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(emerald[0], emerald[1], emerald[2]);
  doc.text(`${formatMoney(paidAmount)} FCFA`, margin + colWidth + 4, y + 17);

  // Col 3: Solde
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  const soldeLabel =
    balance > 0 ? 'RESTE À PAYER (DETTE)' : balance < 0 ? 'TROP-PERÇU' : 'SOLDE DU COMPTE';
  doc.text(soldeLabel, margin + colWidth * 2 + 4, y + 11);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  if (balance > 0) {
    doc.setTextColor(217, 119, 6); // amber/warning
  } else {
    doc.setTextColor(emerald[0], emerald[1], emerald[2]);
  }
  doc.text(`${formatMoney(Math.abs(balance))} FCFA`, margin + colWidth * 2 + 4, y + 17);

  // Status sentence
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(70, 70, 70);
  const statusSentence =
    balance === 0
      ? 'Achat entièrement soldé : le fournisseur a perçu la totalité du règlement.'
      : balance > 0
      ? `Reste à verser au fournisseur : ${formatMoney(balance)} FCFA.`
      : `Le fournisseur a un trop-perçu de ${formatMoney(Math.abs(balance))} FCFA.`;
  doc.text(statusSentence, margin + 4, y + 22.5);

  y += 30;

  // Section 4: Modalités de Règlement (Historique des paiements)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text('MODALITÉS & JUSTIFICATIFS DE RÈGLEMENT', margin, y);

  y += 3;

  const payments = purchase.payments || [];
  if (payments.length === 0) {
    doc.setFillColor(252, 252, 252);
    doc.setDrawColor(230, 230, 230);
    doc.roundedRect(margin, y, contentWidth, 8, 1, 1, 'FD');
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
    doc.text('Aucun versement enregistré immédiatement pour ce bon d’achat.', margin + 4, y + 5.2);
    y += 12;
  } else {
    for (let i = 0; i < Math.min(payments.length, 5); i++) {
      const p = payments[i];
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(230, 235, 240);
      doc.roundedRect(margin, y, contentWidth, 9, 1, 1, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(darkGreen[0], darkGreen[1], darkGreen[2]);
      doc.text(p.method || 'Règlement espèces', margin + 3, y + 5.8);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
      const datePay = formatDateTime(p.paidAt);
      const acc = p.account || 'Caisse principale';
      doc.text(`Date : ${datePay}  ·  Compte : ${acc}${p.note ? ` (${p.note})` : ''}`, margin + 45, y + 5.8);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(emerald[0], emerald[1], emerald[2]);
      doc.text(`${formatMoney(p.amount)} FCFA`, pageWidth - margin - 3, y + 5.8, { align: 'right' });

      y += 10.5;
    }
  }

  y += 4;

  // Legal Disclaimer Note
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  const legalText =
    "* Le vendeur certifie sur l'honneur être le propriétaire légitime du lot d'or présenté et que ce dernier est exempt de tout gage ou litige. Ce bordereau tient lieu d'acte officiel d'achat et de décharge comptable délivré conformément à la réglementation relative au commerce de l'or.";
  const legalLines = doc.splitTextToSize(legalText, contentWidth);
  doc.text(legalLines, margin, y);

  y += legalLines.length * 3 + 4;

  // Signatures Section (2 boxes)
  const sigBoxWidth = (contentWidth - 10) / 2;
  const sigBoxHeight = 28;

  // Box 1: Vendeur
  doc.setDrawColor(180, 185, 190);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.roundedRect(margin, y, sigBoxWidth, sigBoxHeight, 1.5, 1.5, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(darkGreen[0], darkGreen[1], darkGreen[2]);
  doc.text('Signature & Empreinte du Fournisseur', margin + sigBoxWidth / 2, y + 5, { align: 'center' });

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(6.5);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text('« Lu et approuvé, bon pour accord »', margin + sigBoxWidth / 2, y + 9, { align: 'center' });

  // Box 2: Comptoir
  doc.roundedRect(margin + sigBoxWidth + 10, y, sigBoxWidth, sigBoxHeight, 1.5, 1.5, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(darkGreen[0], darkGreen[1], darkGreen[2]);
  doc.text('Visa, Cachet & Signature du Comptoir', margin + sigBoxWidth + 10 + sigBoxWidth / 2, y + 5, {
    align: 'center',
  });

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(6.5);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text('Le Peseur / Caissier habilité', margin + sigBoxWidth + 10 + sigBoxWidth / 2, y + 9, {
    align: 'center',
  });

  // Footer bar
  doc.setLineDashPattern([], 0);
  const footerY = pageHeight - margin + 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(gold[0], gold[1], gold[2]);
  doc.text('CAMS GOLD COMPTOIR', margin, footerY);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text(
    `Destinataire WhatsApp officiel : ${RECIPIENT_WHATSAPP_DISPLAY} · République du Congo`,
    pageWidth - margin,
    footerY,
    { align: 'right' }
  );

  return doc;
};

export const generatePurchaseSlipPdfBlob = (
  purchase: PurchaseRecord,
  operatorName: string
): Blob => {
  const doc = createPurchaseSlipPdfDocument(purchase, operatorName);
  return doc.output('blob');
};

export const downloadPurchaseSlipPdf = (
  purchase: PurchaseRecord,
  operatorName: string
): void => {
  const doc = createPurchaseSlipPdfDocument(purchase, operatorName);
  const safeRef = (purchase.reference || 'bon-achat').replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`Bordereau-Achat-CAMS-GOLD-${safeRef}.pdf`);
};

export const buildWhatsAppSlipMessage = (
  purchase: PurchaseRecord,
  operatorName: string
): string => {
  const gross = purchase.grossWeightGrams ?? purchase.netWeightGrams ?? 0;
  const net = purchase.netWeightGrams ?? gross;
  const karat = purchase.karat || '24K';
  const karatNum = parseFloat(karat.replace('K', '')) || 24;
  const fineGold = (net * karatNum) / 24;
  const paid = (purchase.payments || []).reduce((sum, p) => sum + p.amount, 0);
  const balance = purchase.amount - paid;

  return [
    `🪙 *CAMS GOLD COMPTOIR*`,
    `📄 *NOUVEAU BORDEREAU D'ACHAT D'OR*`,
    `--------------------------------------`,
    `🔹 *Bon d'achat :* N° ${purchase.reference}`,
    `📅 *Date :* ${formatDate(purchase.purchasedAt)}`,
    `👤 *Opérateur :* ${operatorName || 'Comptoir'}`,
    `🤝 *Fournisseur :* ${purchase.supplier || 'Particulier'}`,
    `🏷️ *Catégorie :* ${purchase.goldCategory || 'Or brut'}`,
    ``,
    `⚖️ *DÉTAIL DE LA PESÉE & ANALYSE*`,
    `• Poids brut : *${formatNumber(gross, 2)} g*`,
    `• Tare / Déchets : *${formatNumber(purchase.nonGoldWeightGrams || 0, 2)} g*`,
    `• Poids net : *${formatNumber(net, 2)} g*`,
    `• Titre : *${karat}*`,
    `• Poids fin 24K : *${formatNumber(fineGold, 3)} g*`,
    `• Cours net / g : *${formatMoney(purchase.referencePricePerGram || 0)} FCFA*`,
    ``,
    `💰 *RÈGLEMENT FINANCIER*`,
    `• Montant total : *${formatMoney(purchase.amount)} FCFA*`,
    `• Déjà réglé : *${formatMoney(paid)} FCFA*`,
    balance > 0
      ? `• ⚠️ Reste à verser : *${formatMoney(balance)} FCFA*`
      : `• ✅ Situation : *Intégralement soldé*`,
    ``,
    `📎 _Le bordereau officiel PDF complet a été généré avec succès._`,
    `🏢 _CAMS GOLD COMPTOIR · Brazzaville_`,
  ].join('\n');
};

export const getWhatsAppShareUrl = (
  purchase: PurchaseRecord,
  operatorName: string,
  phone: string = RECIPIENT_WHATSAPP_PHONE
): string => {
  const text = buildWhatsAppSlipMessage(purchase, operatorName);
  return `https://api.whatsapp.com/send?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}`;
};

export const sharePurchaseSlipToWhatsApp = async (
  purchase: PurchaseRecord,
  operatorName: string,
  phone: string = RECIPIENT_WHATSAPP_PHONE
): Promise<{ method: 'share' | 'whatsapp_link'; success: boolean }> => {
  const safeRef = (purchase.reference || 'bon-achat').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `Bordereau-Achat-CAMS-GOLD-${safeRef}.pdf`;
  const pdfBlob = generatePurchaseSlipPdfBlob(purchase, operatorName);
  const pdfFile = new File([pdfBlob], filename, { type: 'application/pdf' });
  const messageText = buildWhatsAppSlipMessage(purchase, operatorName);

  // 1. Try Web Share API with file support (Android/iOS WhatsApp app automatically receives the PDF!)
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [pdfFile] })
  ) {
    try {
      await navigator.share({
        title: `Bordereau Achat Or ${purchase.reference} - CAMS GOLD`,
        text: messageText,
        files: [pdfFile],
      });
      return { method: 'share', success: true };
    } catch (e: unknown) {
      if ((e as Error)?.name === 'AbortError') {
        // User cancelled share picker
        return { method: 'share', success: false };
      }
    }
  }

  // 2. Direct WhatsApp Click to Chat with full details & automated download
  openWhatsAppPurchaseSlip(purchase, operatorName, phone);
  return { method: 'whatsapp_link', success: true };
};

export const openWhatsAppPurchaseSlip = (
  purchase: PurchaseRecord,
  operatorName: string,
  phone: string = RECIPIENT_WHATSAPP_PHONE
): void => {
  // 1. Download the certified PDF
  try {
    downloadPurchaseSlipPdf(purchase, operatorName);
  } catch (e) {
    console.warn('PDF download warning:', e);
  }

  // 2. Open WhatsApp directly with official wa.me link without navigating away from the app iframe
  const messageText = buildWhatsAppSlipMessage(purchase, operatorName);
  const cleanPhone = phone.replace(/\D/g, '');
  const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(messageText)}`;

  try {
    const link = document.createElement('a');
    link.href = whatsappUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (e) {
    console.warn('Unable to open WhatsApp link:', e);
  }
};
