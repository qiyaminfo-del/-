import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from '@/store/session';
import Layout from '@/components/Layout';
import { Loading } from '@/components/ui';
import Login from '@/pages/Login';
import Home from '@/pages/Home';
import MyList from '@/pages/MyList';
import Attendance from '@/pages/Attendance';
import Fees from '@/pages/Fees';
import Tasks from '@/pages/Tasks';
import Summaries from '@/pages/Summaries';
import SessionReport from '@/pages/SessionReport';
import TeamReport from '@/pages/TeamReport';
import Admin from '@/pages/Admin';

export default function App() {
  const { loading, auth, init } = useApp();

  useEffect(() => {
    void init();
  }, [init]);

  if (loading) return <Loading label="جارٍ فتح المنصة…" />;
  if (!auth) return <Login />;

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="my-list" element={<MyList />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="fees" element={<Fees />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="summaries" element={<Summaries />} />
          <Route path="report" element={<SessionReport />} />
          <Route path="team" element={<TeamReport />} />
          <Route path="admin" element={<Admin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
