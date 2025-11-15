import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './components/auth/AuthProvider';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import NewProjectPage from './pages/NewProjectPage';
import ProjectPage from './pages/ProjectPage';
import HomePage from './pages/HomePage';
import '@/lib/amplify';

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/project/new" element={<NewProjectPage />} />
        <Route path="/project/:id" element={<ProjectPage />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;

