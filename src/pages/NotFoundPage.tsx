import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { GlassCard } from "../components/ui/GlassCard";

export function NotFoundPage() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <GlassCard className="max-w-sm p-8 text-center">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500/12 text-brand-500">
          <Compass size={26} />
        </span>
        <h1 className="text-lg font-extrabold">صفحه پیدا نشد</h1>
        <p className="mt-2 text-[13px] leading-6 text-ink-500 dark:text-ink-400">
          آدرسی که دنبالش هستید وجود ندارد یا جابه‌جا شده است.
        </p>
        <Link to="/" className="btn btn-primary mt-5 inline-flex">
          بازگشت به داشبورد
        </Link>
      </GlassCard>
    </div>
  );
}
