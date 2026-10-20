import { useNavigate } from 'react-router-dom';

/** 统一返回按钮：指定 to 则回固定页，否则回上一页（无历史时回首页）。 */
export default function BackButton({ to, label = '返回' }: { to?: string; label?: string }) {
  const nav = useNavigate();
  return (
    <button className="back-btn" onClick={() => {
      if (to) nav(to);
      else if (window.history.length > 1) nav(-1);
      else nav('/');
    }}>
      ← {label}
    </button>
  );
}
