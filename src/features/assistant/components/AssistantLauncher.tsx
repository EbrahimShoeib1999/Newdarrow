import { useMemo, useState } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  Tabs,
  Tab,
  Input,
  Textarea,
  Button,
  Card,
  CardBody,
  Chip,
  Divider,
  Spinner,
} from "@heroui/react";
import { Sparkles, MessageSquare, LifeBuoy, Search, Send, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";
import { useCompany } from "@/features/companies/context/company-context";
import { useCompanyProfile } from "@/features/companies/hooks/use-company-profile";
import { searchHelp } from "../data/help-knowledge";
import { isLiveAssistantEnabled, askAssistant } from "../lib/ai-provider";
import {
  buildSupportMessage,
  buildSupportWhatsAppUrl,
  safePageReference,
  type SupportLang,
} from "../utils/support-whatsapp";
import { raiseSupportTicket } from "../api/support-escalation";

/**
 * Persistent, unobtrusive in-app assistant (Phase 8A). Mounted once inside the
 * authenticated AppLayout so the entry point is available across every portal.
 * It is read/advice only: it explains features, helps navigate, and escalates to
 * a human. It never performs privileged or financial mutations on its own.
 */
export function AssistantLauncher() {
  const { t, i18n } = useTranslation("assistant");
  const lang: SupportLang = i18n.language?.startsWith("ar") ? "ar" : "en";
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { companyId } = useCompany();
  const user = useAuthStore((s) => s.user);
  const { data: profile } = useCompanyProfile();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<{ ok: boolean; text?: string; reason?: string } | null>(null);

  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");
  const [raising, setRaising] = useState(false);

  const liveEnabled = useMemo(() => isLiveAssistantEnabled(), []);
  const articles = useMemo(() => searchHelp(query), [query]);

  // Support number comes ONLY from tenant configuration — never invented here.
  const supportPhone = profile?.whatsappSupportPhone || profile?.phone || "";
  const pageRef = safePageReference(pathname);
  const whatsappUrl = buildSupportWhatsAppUrl(
    supportPhone,
    buildSupportMessage(lang, { pageRef })
  );

  const onAsk = async () => {
    if (!question.trim()) return;
    setAsking(true);
    setAnswer(null);
    const res = await askAssistant(question, { lang, pageRef });
    setAnswer({ ok: res.ok, text: res.text, reason: res.reason });
    setAsking(false);
  };

  const onRaiseTicket = async () => {
    if (!companyId || !subject.trim()) return;
    setRaising(true);
    try {
      const r = await raiseSupportTicket({
        companyId,
        actorId: user?.id ?? "unknown",
        actorName: user?.name ?? "",
        subject,
        description: details,
        pageRef,
      });
      toast.success(t("support.ticketCreated", { count: r.notified }));
      setSubject("");
      setDetails("");
    } catch {
      toast.error(t("support.ticketFailed"));
    } finally {
      setRaising(false);
    }
  };

  return (
    <>
      {/* Floating entry point */}
      <button
        type="button"
        aria-label={t("launcherAria")}
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-6 z-40 flex h-12 w-12 items-center justify-center rounded-full shadow-lg",
          "bg-primary text-white transition-transform hover:scale-105",
          i18n.language?.startsWith("ar") ? "left-6" : "right-6"
        )}
      >
        <Sparkles className="h-5 w-5" />
      </button>

      <Drawer isOpen={open} onOpenChange={setOpen} placement={i18n.language?.startsWith("ar") ? "left" : "right"}>
        <DrawerContent>
          {(onClose) => (
            <>
              <DrawerHeader className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                {t("title")}
              </DrawerHeader>
              <DrawerBody className="pb-8">
                <Tabs aria-label={t("title")} variant="underlined" classNames={{ tab: "text-sm font-bold" }}>
                  {/* ---- Help (safe, deterministic, no AI) ---- */}
                  <Tab key="help" title={t("tabs.help")}>
                    <div className="space-y-3 pt-2">
                      <Input
                        size="sm"
                        startContent={<Search className="h-4 w-4 text-default-400" />}
                        placeholder={t("help.searchPlaceholder")}
                        value={query}
                        onValueChange={setQuery}
                      />
                      {articles.length === 0 && (
                        <p className="py-6 text-center text-sm text-default-400">{t("help.empty")}</p>
                      )}
                      {articles.map((a) => (
                        <Card key={a.id} className="border border-default-100">
                          <CardBody className="gap-1.5">
                            <p className="text-sm font-bold">{a.title[lang]}</p>
                            <p className="text-xs text-default-500">{a.body[lang]}</p>
                            {a.link && (
                              <Button
                                size="sm"
                                variant="light"
                                className="self-start mt-1"
                                endContent={<ExternalLink className="h-3.5 w-3.5" />}
                                onPress={() => {
                                  navigate(a.link!);
                                  onClose();
                                }}
                              >
                                {t("help.open")}
                              </Button>
                            )}
                          </CardBody>
                        </Card>
                      ))}
                    </div>
                  </Tab>

                  {/* ---- Assistant (live AI when a trusted backend is configured) ---- */}
                  <Tab key="assistant" title={t("tabs.assistant")}>
                    <div className="space-y-3 pt-2">
                      {!liveEnabled && (
                        <Card className="border border-warning-200 bg-warning-50">
                          <CardBody className="gap-1">
                            <p className="text-sm font-bold text-warning">{t("assistant.unavailableTitle")}</p>
                            <p className="text-xs text-default-600">{t("assistant.unavailableBody")}</p>
                          </CardBody>
                        </Card>
                      )}
                      <Textarea
                        size="sm"
                        label={t("assistant.questionLabel")}
                        placeholder={t("assistant.questionPlaceholder")}
                        value={question}
                        onValueChange={setQuestion}
                        minRows={2}
                      />
                      <Button
                        size="sm"
                        color="primary"
                        variant="flat"
                        startContent={<Send className="h-3.5 w-3.5" />}
                        isLoading={asking}
                        isDisabled={!liveEnabled || !question.trim()}
                        onPress={onAsk}
                      >
                        {t("assistant.ask")}
                      </Button>

                      {asking && (
                        <div className="flex items-center gap-2 text-xs text-default-500">
                          <Spinner size="sm" /> {t("assistant.thinking")}
                        </div>
                      )}
                      {answer?.ok && answer.text && (
                        <Card className="border border-default-100">
                          <CardBody className="gap-1">
                            <p className="text-[11px] font-bold uppercase text-default-400">{t("assistant.answer")}</p>
                            {/* Untrusted provider output rendered as plain text, never as HTML. */}
                            <p className="whitespace-pre-wrap text-sm">{answer.text}</p>
                            <p className="text-[10px] text-default-400">{t("assistant.untrustedHint")}</p>
                          </CardBody>
                        </Card>
                      )}
                      {answer && !answer.ok && (
                        <Chip size="sm" variant="flat" color="warning">
                          {t(`assistant.errors.${answer.reason === "blocked" ? "blocked" : answer.reason?.startsWith("http") ? "http" : answer.reason ?? "network"}`)}
                        </Chip>
                      )}
                    </div>
                  </Tab>

                  {/* ---- Support (WhatsApp from config + ticket escalation) ---- */}
                  <Tab key="support" title={t("tabs.support")}>
                    <div className="space-y-4 pt-2">
                      <div className="space-y-2">
                        <p className="text-xs font-bold uppercase text-default-400">{t("support.whatsapp")}</p>
                        {whatsappUrl ? (
                          <Button
                            size="sm"
                            color="success"
                            variant="flat"
                            startContent={<MessageSquare className="h-4 w-4" />}
                            as="a"
                            href={whatsappUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t("support.openWhatsApp")}
                          </Button>
                        ) : (
                          <p className="text-xs text-default-500">{t("support.notConfigured")}</p>
                        )}
                        <Divider />
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-bold uppercase text-default-400">{t("support.ticket")}</p>
                        <Input
                          size="sm"
                          label={t("support.subject")}
                          value={subject}
                          onValueChange={setSubject}
                        />
                        <Textarea
                          size="sm"
                          label={t("support.details")}
                          value={details}
                          onValueChange={setDetails}
                          minRows={3}
                        />
                        <Button
                          size="sm"
                          color="primary"
                          startContent={<LifeBuoy className="h-4 w-4" />}
                          isLoading={raising}
                          isDisabled={!subject.trim()}
                          onPress={onRaiseTicket}
                        >
                          {t("support.submit")}
                        </Button>
                      </div>
                    </div>
                  </Tab>
                </Tabs>
              </DrawerBody>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </>
  );
}
