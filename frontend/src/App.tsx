import { Routes, Route } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import NewProjectPage from './pages/NewProjectPage';
import SimpleCreatePage from './pages/SimpleCreatePage';
import ScriptAssetGenerationPage from './pages/ScriptAssetGenerationPage';
import ProjectPage from './pages/ProjectPage';
import ProjectEditorPage from './pages/ProjectEditorPage';
import HomePage from './pages/HomePage';
import AuthCallbackPage from './pages/AuthCallbackPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/create" element={<SimpleCreatePage />} />
      <Route path="/project/new" element={<NewProjectPage />} />
      <Route path="/project/:id/generate" element={<ScriptAssetGenerationPage />} />
      <Route path="/project/:id/edit" element={<ProjectEditorPage />} />
      <Route path="/project/:id" element={<ProjectPage />} />
    </Routes>
  );
}

export default App;

