import React, { useState } from 'react';
import { 
  HelpCircle, MessageSquare, Send, CheckCircle2, Search, 
  Clock, ShieldAlert, ArrowRight, RefreshCw, FileText 
} from 'lucide-react';
import { SupportTicket } from '../../types';
import { apiClient } from '../../services/apiClient';
import { Language, translations } from '../../i18n';

interface SupportViewProps {
  initialOrderId?: string;
  lang: Language;
}

export const SupportView: React.FC<SupportViewProps> = ({ initialOrderId, lang }) => {
  // Ticket form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState(initialOrderId ? `Problème commande #${initialOrderId}` : '');
  const [category, setCategory] = useState<'order' | 'api' | 'payment' | 'account' | 'other'>(initialOrderId ? 'order' : 'order');
  const [orderId, setOrderId] = useState(initialOrderId || '');
  const [message, setMessage] = useState('');
  const [ticketCreated, setTicketCreated] = useState<SupportTicket | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Ticket lookup
  const [lookupNumber, setLookupNumber] = useState('');
  const [lookupTicket, setLookupTicket] = useState<SupportTicket | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const ticket = await apiClient.createTicket({
        name,
        email,
        subject,
        category,
        message,
        orderId: orderId || undefined
      });
      setTicketCreated(ticket);
    } catch (err: any) {
      setErrorMsg(err.message || 'Échec de création du ticket');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupNumber.trim()) return;
    setLookupLoading(true);
    setLookupError(null);
    setLookupTicket(null);
    try {
      const res = await apiClient.getTicket(lookupNumber.trim());
      setLookupTicket(res);
    } catch (err: any) {
      setLookupError('Aucun ticket trouvé avec cet identifiant.');
    } finally {
      setLookupLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">
      {/* Header */}
      <div className="max-w-3xl">
        <span className="text-xs font-semibold uppercase tracking-wider text-orange-600">
          Assistance & Service Client
        </span>
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 mt-1">
          Centre de Support PlayUp
        </h1>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          Notre équipe technique et nos agents vous accompagnent pour vos recharges, intégrations API et questions de facturation.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Contact Form / Ticket Submission */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-bold text-slate-900">
                Ouvrir un ticket d’assistance
              </h2>
              <p className="text-xs text-slate-500">
                Réponse moyenne sous 15 minutes par nos spécialistes gaming.
              </p>
            </div>
          </div>

          {ticketCreated ? (
            <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-4">
              <div className="flex items-center gap-2 text-emerald-800 font-bold">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span>Ticket #{ticketCreated.ticketNumber} enregistré !</span>
              </div>
              <p className="text-xs text-emerald-900 leading-relaxed">
                Votre demande a été attribuée à notre équipe support. Conservez votre numéro de ticket <strong className="font-mono">{ticketCreated.ticketNumber}</strong> pour suivre son traitement ci-contre.
              </p>
              <button
                onClick={() => {
                  setTicketCreated(null);
                  setMessage('');
                  setSubject('');
                }}
                className="px-4 py-2 bg-emerald-700 text-white rounded-xl text-xs font-semibold"
              >
                Créer une autre demande
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              {errorMsg && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl">
                  {errorMsg}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Votre Nom / Pseudo</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="ex: Robenson Alexis"
                    className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Adresse Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ex: alexis@gmail.com"
                    className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Catégorie</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-orange-500"
                  >
                    <option value="order">Commande / Livraison de diamants</option>
                    <option value="api">Intégration API / Clé d'API</option>
                    <option value="payment">Paiement / Facturation</option>
                    <option value="account">Compte revendeur</option>
                    <option value="other">Autre demande</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">N° de Commande (facultatif)</label>
                  <input
                    type="text"
                    value={orderId}
                    onChange={(e) => setOrderId(e.target.value)}
                    placeholder="ex: PLUP-2026-98210"
                    className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-mono focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Sujet de la demande</label>
                <input
                  type="text"
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="ex: Vérification de livraison Free Fire 310 Diamants"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Message détaillé</label>
                <textarea
                  rows={4}
                  required
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Expliquez précisément votre demande ou le problème rencontré..."
                  className="w-full border border-slate-300 rounded-xl p-3 text-xs focus:outline-none focus:border-orange-500"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs shadow-md transition-colors flex items-center justify-center gap-2"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{submitting ? 'Envoi en cours...' : 'Envoyer la demande'}</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Right: Ticket Tracking + FAQ */}
        <div className="lg:col-span-5 space-y-6">
          {/* Lookup Box */}
          <div className="bg-slate-50 border border-slate-200 rounded-3xl p-6 space-y-4">
            <h3 className="font-display text-base font-bold text-slate-900">
              Suivre l'état d'un ticket existant
            </h3>
            <form onSubmit={handleLookup} className="flex gap-2">
              <input
                type="text"
                value={lookupNumber}
                onChange={(e) => setLookupNumber(e.target.value)}
                placeholder="N° de ticket (ex: TKT-9012)"
                className="flex-1 border border-slate-300 bg-white rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-orange-500"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 transition-colors"
              >
                Vérifier
              </button>
            </form>

            {lookupLoading && (
              <p className="text-xs text-slate-500">Recherche du ticket...</p>
            )}

            {lookupError && (
              <p className="text-xs text-red-600 font-medium">{lookupError}</p>
            )}

            {lookupTicket && (
              <div className="p-4 bg-white border border-slate-200 rounded-2xl space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-slate-900">#{lookupTicket.ticketNumber}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    lookupTicket.status === 'resolved' ? 'bg-emerald-100 text-emerald-800' :
                    lookupTicket.status === 'in_progress' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {lookupTicket.status}
                  </span>
                </div>
                <div>
                  <div className="font-semibold text-slate-900">{lookupTicket.subject}</div>
                  <div className="text-slate-500 text-[11px] mt-0.5">
                    Créé le {new Date(lookupTicket.createdAt).toLocaleDateString()}
                  </div>
                </div>

                {/* Messages conversation */}
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Historique des réponses ({lookupTicket.messages.length})
                  </span>
                  {lookupTicket.messages.map(m => (
                    <div 
                      key={m.id}
                      className={`p-2.5 rounded-xl ${
                        m.sender === 'agent' 
                          ? 'bg-orange-50 text-orange-950 border border-orange-100' 
                          : 'bg-slate-100 text-slate-900'
                      }`}
                    >
                      <div className="flex justify-between font-semibold text-[11px] mb-1">
                        <span>{m.senderName}</span>
                        <span className="text-[10px] opacity-70">
                          {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="leading-relaxed">{m.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Quick FAQ */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 space-y-4">
            <h3 className="font-display text-base font-bold text-slate-900">
              Questions Fréquentes (FAQ)
            </h3>
            <div className="space-y-3 text-xs text-slate-600">
              <details className="group border-b border-slate-100 pb-2">
                <summary className="font-semibold text-slate-800 cursor-pointer list-none flex justify-between items-center">
                  <span>Combien de temps prend une livraison ?</span>
                  <span className="group-open:rotate-180 transition-transform">▾</span>
                </summary>
                <p className="pt-2 text-slate-500 leading-relaxed">
                  Grâce à nos passerelles directes avec les éditeurs, les livraisons s'effectuent généralement en moins de 30 secondes après confirmation.
                </p>
              </details>

              <details className="group border-b border-slate-100 pb-2">
                <summary className="font-semibold text-slate-800 cursor-pointer list-none flex justify-between items-center">
                  <span>Que faire si mon ID joueur est erroné ?</span>
                  <span className="group-open:rotate-180 transition-transform">▾</span>
                </summary>
                <p className="pt-2 text-slate-500 leading-relaxed">
                  Si le serveur de jeu rejette l'identifiant, la commande est marquée en échec et votre solde revendeur est automatiquement remboursé.
                </p>
              </details>

              <details className="group">
                <summary className="font-semibold text-slate-800 cursor-pointer list-none flex justify-between items-center">
                  <span>Comment devenir revendeur officiel ?</span>
                  <span className="group-open:rotate-180 transition-transform">▾</span>
                </summary>
                <p className="pt-2 text-slate-500 leading-relaxed">
                  Créez un compte dans l'Espace Reseller. Vous obtiendrez immédiatement 50 USD de crédit Sandbox pour tester notre API avec vos clés.
                </p>
              </details>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
