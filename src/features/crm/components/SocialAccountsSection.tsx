import { useState } from "react";
import { Button, Input, Select, SelectItem } from "@heroui/react";
import { Plus, Trash2, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ContactSocialAccount } from "../types/contacts.types";

interface SocialAccountsSectionProps {
  accounts: ContactSocialAccount[];
  onChange: (accounts: ContactSocialAccount[]) => void;
  isAr?: boolean;
}

const COMMON_PLATFORMS = [
  "Instagram",
  "TikTok",
  "Snapchat",
  "X",
  "YouTube",
  "LinkedIn",
  "Facebook",
  "WhatsApp",
  "Website / Blog",
  "Other",
];

export function SocialAccountsSection({
  accounts,
  onChange,
}: SocialAccountsSectionProps) {
  const { t } = useTranslation("crm");
  const [platform, setPlatform] = useState("Instagram");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = () => {
    if (!platform.trim()) return;
    const newAcc: ContactSocialAccount = {
      id: crypto.randomUUID(),
      platform: platform.trim(),
      url: url.trim(),
      username: username.trim() || undefined,
    };
    onChange([...accounts, newAcc]);
    setUrl("");
    setUsername("");
    setIsAdding(false);
  };

  const handleRemove = (id: string) => {
    onChange(accounts.filter((a) => a.id !== id));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-default-700">
          {t("contacts.socialAccounts.title")}
        </label>
        {!isAdding && (
          <Button
            size="sm"
            variant="flat"
            color="primary"
            onPress={() => setIsAdding(true)}
            startContent={<Plus className="h-3.5 w-3.5" />}
          >
            {t("contacts.socialAccounts.add")}
          </Button>
        )}
      </div>

      {isAdding && (
        <div className="rounded-2xl border border-primary-200 bg-primary-50/20 p-3.5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <Select
              size="sm"
              label={t("contacts.socialAccounts.platform")}
              selectedKeys={[platform]}
              onSelectionChange={(keys) => {
                const k = Array.from(keys)[0] as string;
                if (k) setPlatform(k);
              }}
            >
              {COMMON_PLATFORMS.map((p) => (
                <SelectItem key={p} textValue={p}>
                  {p}
                </SelectItem>
              ))}
            </Select>

            <Input
              size="sm"
              label={t("contacts.socialAccounts.url")}
              placeholder="https://..."
              value={url}
              onValueChange={setUrl}
            />

            <Input
              size="sm"
              label={t("contacts.socialAccounts.username")}
              placeholder="@username"
              value={username}
              onValueChange={setUsername}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="light" onPress={() => setIsAdding(false)}>
              {t("contacts.form.cancel")}
            </Button>
            <Button size="sm" color="primary" onPress={handleAdd}>
              {t("contacts.socialAccounts.add")}
            </Button>
          </div>
        </div>
      )}

      {accounts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {accounts.map((acc) => (
            <div
              key={acc.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-default-200 bg-default-50/50 p-2.5 text-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Globe className="h-4 w-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <span className="font-bold text-default-800">{acc.platform}</span>
                  {acc.username && (
                    <span className="text-default-500 ms-1.5" dir="ltr">
                      ({acc.username})
                    </span>
                  )}
                  {acc.url && (
                    <a
                      href={acc.url.startsWith("http") ? acc.url : `https://${acc.url}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-[11px] text-primary hover:underline"
                      dir="ltr"
                    >
                      {acc.url}
                    </a>
                  )}
                </div>
              </div>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                color="danger"
                onPress={() => handleRemove(acc.id)}
              >
                <Trash2 className="h-3.5 w-3.5 text-danger" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
