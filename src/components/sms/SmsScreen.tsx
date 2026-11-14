import React, { useState, useEffect } from 'react';
import {
  MessageSquare,
  Send,
  Copy,
  Check,
  Phone,
} from 'lucide-react';
import { useAppStore } from '../../context/AppContext';
import { AppPanel, PageHeading, SectionHeading } from '../common/UIComponents';

export const SmsScreen: React.FC = () => {
  const store = useAppStore();
  const canSendSms = store.canAccessService(8, 'sms.send');

  const contactsWithPhone = store.contacts.filter((c) => Boolean(c.phone));
  const [selectedContactRef, setSelectedContactRef] = useState(contactsWithPhone[0]?.reference || '');
  const [messageText, setMessageText] = useState('');
  const [copied, setCopied] = useState(false);
  const [autoBroadcast9h, setAutoBroadcast9h] = useState(true);
  const [lastBroadcastDate, setLastBroadcastDate] = useState<string | null>(() => {
    try {
      return localStorage.getItem('cams_whatsapp_9h_last_date');
    } catch {
      return null;
    }
  });
  const [sentMessages, setSentMessages] = useState<Array<{ to: string; phone: string; text: string; time: string }>>([]);

  const selectedContact = store.contacts.find((c) => c.reference === selectedContactRef);

  const handleApplyTemplate = (tmpl: string) => {
    setMessageText(tmpl);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(messageText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const buildDailyMarketMessage = () => {
    if (messageText.trim()) return messageText.trim();
    return 'Bonjour, CAMS GOLD vous souhaite une excellente journée. Contactez-nous pour vos opérations Or et Devises.';
  };

  const broadcastAllWhatsApp = (isAuto = false) => {
    if (!canSendSms || contactsWithPhone.length === 0) return;
    const body = buildDailyMarketMessage();
    const timeLabel = isAuto ? 'Auto 09h00' : 'À l’instant';
    const newEntries = contactsWithPhone.map((c) => ({
      to: c.name,
      phone: c.phone,
      text: body,
      time: timeLabel,
    }));
    setSentMessages((prev) => [...newEntries, ...prev]);

    // Open WhatsApp for the first contact (and log all)
    const firstDigits = contactsWithPhone[0].phone.replace(/[^\d]/g, '');
    if (firstDigits) {
      window.open(`https://wa.me/${firstDigits}?text=${encodeURIComponent(body)}`, '_blank', 'noopener,noreferrer');
    }
  };

  useEffect(() => {
    if (!canSendSms || !autoBroadcast9h) return;
    const checkSchedule = () => {
      const now = new Date();
      const todayKey = now.toISOString().slice(0, 10);
      if (now.getHours() === 9 && now.getMinutes() === 0 && lastBroadcastDate !== todayKey) {
        setLastBroadcastDate(todayKey);
        try {
          localStorage.setItem('cams_whatsapp_9h_last_date', todayKey);
        } catch {
          // ignore storage error
        }
        broadcastAllWhatsApp(true);
      }
    };
    const timer = setInterval(checkSchedule, 30000);
    return () => clearInterval(timer);
  }, [canSendSms, autoBroadcast9h, lastBroadcastDate, contactsWithPhone.length, messageText]);

  const handleSend = () => {
    if (!canSendSms || !selectedContact || !messageText.trim()) return;

    setSentMessages([
      {
        to: selectedContact.name,
        phone: selectedContact.phone,
        text: messageText,
        time: 'À l’instant',
      },
      ...sentMessages,
    ]);

    const cleanPhone = selectedContact.phone.replace(/[^\d]/g, '');
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(messageText)}`, '_blank', 'noopener,noreferrer');
  };

  if (!canSendSms) {
    return (
      <div className="p-4 sm:p-7 max-w-7xl mx-auto space-y-6">
        <PageHeading eyebrow="Communication · WhatsApp Uniquement" title="Messages WhatsApp & Diffusion 09h00" />
        <AppPanel className="p-8 text-center text-xs text-gray-500">
          Votre compte n’est pas autorisé à envoyer des messages WhatsApp / SMS. Contactez l’administrateur.
        </AppPanel>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-7 max-w-7xl mx-auto space-y-6">
      <PageHeading
        eyebrow="Communication · WhatsApp Uniquement"
        title="Messages WhatsApp & Diffusion 09h00"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAutoBroadcast9h((v) => !v)}
              className={`px-3 py-2 rounded-xl text-xs font-bold border cursor-pointer ${
                autoBroadcast9h
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                  : 'bg-white border-gray-200 text-gray-600'
              }`}
            >
              Envoi Auto 09h00 : {autoBroadcast9h ? 'ACTIF' : 'INACTIF'}
            </button>
            <button
              type="button"
              onClick={() => broadcastAllWhatsApp(false)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
            >
              <Send size={14} />
              <span>Diffuser WhatsApp à tous ({contactsWithPhone.length})</span>
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* SMS Composer */}
        <AppPanel className="lg:col-span-2 space-y-5">
          <SectionHeading title="Rédiger un SMS" icon={<MessageSquare size={18} />} />

          <div>
            <label className="block text-xs font-bold text-[#192A24] mb-1.5">
              Destinataire
            </label>
            <select
              value={selectedContactRef}
              onChange={(e) => setSelectedContactRef(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs font-bold text-[#192A24]"
            >
              {contactsWithPhone.map((c) => (
                <option key={c.reference} value={c.reference}>
                  {c.name} · {c.phone} ({c.city})
                </option>
              ))}
            </select>
          </div>

          {/* Predefined message templates */}
          <div>
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-2">
              Modèles rapides
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  handleApplyTemplate(
                    `Bonjour ${
                      selectedContact?.name || ''
                    }, confirmation de notre rendez-vous au comptoir Cams Gold ce jour.`
                  )
                }
                className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-[11px] text-gray-700 cursor-pointer"
              >
                Confirmation RDV
              </button>

              <button
                type="button"
                onClick={() =>
                  handleApplyTemplate(
                    `Bonjour, nous disposons d'une réserve de devises disponibles au comptoir (USD/EUR) au meilleur taux.`
                  )
                }
                className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-[11px] text-gray-700 cursor-pointer"
              >
                Disponibilité devises
              </button>

              <button
                type="button"
                onClick={() =>
                  handleApplyTemplate(
                    `Bordereau prêt : Votre paiement pour le dernier lot d’or est disponible en caisse ou par virement bancaire.`
                  )
                }
                className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-[11px] text-gray-700 cursor-pointer"
              >
                Règlement prêt
              </button>
            </div>
          </div>

          {/* Message Area */}
          <div>
            <div className="flex items-center justify-between text-xs font-bold text-[#192A24] mb-1.5">
              <label>Message SMS</label>
              <span className="text-[11px] text-gray-400 font-mono">
                {messageText.length} caractères ({Math.ceil(messageText.length / 160) || 1} SMS)
              </span>
            </div>
            <textarea
              rows={5}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="Saisissez votre message pour le client..."
              className="w-full p-3.5 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs leading-relaxed focus:outline-hidden focus:border-[#D39725]"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#E8D8BE] text-xs font-bold text-[#7D8176] hover:bg-gray-50 cursor-pointer"
            >
              {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
              <span>{copied ? 'Copié !' : 'Copier texte'}</span>
            </button>

            <button
              type="button"
              onClick={handleSend}
              disabled={!messageText.trim()}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#008B62] hover:bg-[#007452] text-white text-xs font-extrabold shadow-xs cursor-pointer disabled:opacity-50 transition-colors"
            >
              <Send size={15} />
              <span>Ouvrir dans l'application SMS</span>
            </button>
          </div>
        </AppPanel>

        {/* History Feed */}
        <AppPanel className="space-y-4">
          <SectionHeading title="Messages récents" />
          <div className="divide-y divide-gray-100">
            {sentMessages.map((m, idx) => (
              <div key={idx} className="py-3 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#192A24]">{m.to}</span>
                  <span className="text-[10px] text-gray-400">{m.time}</span>
                </div>
                <div className="text-[11px] text-[#7D8176] font-mono">{m.phone}</div>
                <p className="p-2 rounded-lg bg-gray-50 text-gray-700 italic border border-gray-100 text-[11px] mt-1">
                  {m.text}
                </p>
              </div>
            ))}
          </div>
        </AppPanel>
      </div>
    </div>
  );
};
