import { Users, FolderKanban, UserRound, Settings } from "lucide-react";

const features = [
  { title: "مشتریان", description: "مدیریت پرونده‌ها و مدارک مشتریان", icon: Users },
  { title: "درخواست‌های ویزا", description: "پیگیری وضعیت درخواست‌ها", icon: FolderKanban },
  { title: "نمایندگان", description: "مدیریت نمایندگان و عملکرد آن‌ها", icon: UserRound },
  { title: "تنظیمات", description: "تنظیم فیلدها و گزینه‌های برنامه", icon: Settings },
];

export default function App() {
  return (
    <main className="app-shell">
      <header className="topbar glass">
        <div className="brand-mark">C</div>
        <div>
          <strong>Customer</strong>
          <div className="muted small">سامانه مدیریت ویزا</div>
        </div>
        <span className="offline-label">ذخیره‌سازی محلی</span>
      </header>

      <section className="welcome">
        <p className="eyebrow">مدیریت یکپارچه پرونده‌ها</p>
        <h1>همه‌چیز، مرتب و در دسترس.</h1>
        <p className="muted">
          مشتریان، درخواست‌ها، نمایندگان و پرداخت‌ها را در یک فضای منظم مدیریت کن.
        </p>
      </section>

      <section className="feature-grid">
        {features.map(({ title, description, icon: Icon }) => (
          <article className="feature-card glass" key={title}>
            <div className="feature-icon"><Icon size={23} /></div>
            <h2>{title}</h2>
            <p className="muted">{description}</p>
            <span className="coming-soon">بخش اولیه</span>
          </article>
        ))}
      </section>

      <nav className="bottom-dock glass" aria-label="ناوبری اصلی">
        <a className="active" href="#home">خانه</a>
        <a href="#customers">مشتریان</a>
        <a href="#requests">درخواست‌ها</a>
        <a href="#more">بیشتر</a>
      </nav>

      <footer className="footer muted">
        نسخه اولیه رابط کاربری — اطلاعات واقعی هنوز ثبت نمی‌شود.
      </footer>
    </main>
  );
}
