import { Navigate, Route, Routes } from "react-router-dom";
import ProjectEditor from "./pages/ProjectEditor";
import ProjectList from "./pages/ProjectList";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ProjectList />} />
      <Route path="/projects/:projectId" element={<ProjectEditor />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
