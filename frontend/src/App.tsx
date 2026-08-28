import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

type Session = {
  id: number;
  session_code: string;
  school_name: string;
  photo_date: string | null;
  period: string | null;
  status: string;
  total_photos?: number;
};

type ImportSummary = {
  total: number;
  valid: number;
  invalid: number;
  sheet_name: string;
  header_row_number: number;
  columns: string[];
  mapping: Record<string, string>;
  duplicate_photo_numbers?: number;
};

type Student = {
  id: number;
  import_row_number: number | null;
  photo_number: string | null;
  student_code: string | null;
  student_name: string;
  class_name: string | null;
  original_filename: string | null;
  final_filename: string | null;
  serial_filename: string | null;
  photo_status: string;
  match_status: MatchStatus;
  rename_status: "PENDING" | "DONE" | "FAILED";
  source_path: string | null;
  destination_path: string | null;
  serial_path: string | null;
  is_valid: 0 | 1;
  validation_errors: string | null;
  raw_data: Record<string, string>;
};

type PhotoSummary = {
  folder_path: string;
  total: number;
  preview: Photo[];
};

type Photo = {
  id?: number;
  filename: string;
  extension: string;
  source_path: string;
  file_size: number;
  photo_status?: string;
};

type MatchStatus =
  | "MATCHED"
  | "PHOTO_MISSING"
  | "DATA_NOT_FOUND"
  | "DUPLICATE_NUMBER"
  | "FILENAME_CONFLICT"
  | "INVALID_DATA"
  | "PENDING";

type MatchItem = {
  type: "student" | "photo";
  student_id?: number;
  photo_id?: number;
  photo_number: string | null;
  student_name: string | null;
  original_filename: string | null;
  final_filename: string | null;
  source_path: string | null;
  status: MatchStatus;
  notes: string | null;
};

type MatchSummary = {
  total_students: number;
  total_photos: number;
  matched: number;
  photo_missing: number;
  data_not_found: number;
  duplicates: number;
  conflicts: number;
};

type RenameSummary = {
  requested: number;
  renamed: number;
  failed: number;
  skipped: number;
};

type QcStatus = "PENDING" | "APPROVED" | "NEEDS_REVIEW" | "REJECTED";

type RenamedItem = {
  id: number;
  photo_number: string | null;
  student_name: string;
  class_name: string | null;
  original_filename: string | null;
  final_filename: string | null;
  serial_filename: string | null;
  rename_status: "DONE" | "FAILED";
  qc_status: QcStatus;
  qc_notes: string | null;
  destination_path: string | null;
  serial_path: string | null;
  notes: string | null;
};

type QcSummary = {
  done: number;
  failed: number;
  pending: number;
  approved: number;
  needs_review: number;
  rejected: number;
};

type ManifestResult = {
  path: string;
  total_rows: number;
};

type ProcessingItem = {
  id: number;
  photo_number: string | null;
  student_name: string;
  class_name: string | null;
  final_filename: string | null;
  destination_path: string | null;
  processing_status: "PENDING" | "READY" | "FAILED";
  processing_path: string | null;
  processing_background: string | null;
  processing_notes: string | null;
};

type ProcessingSummary = {
  pending: number;
  ready: number;
  failed: number;
};

type ProcessRunSummary = {
  requested: number;
  processed: number;
  failed: number;
  skipped: number;
};

type ApiResponse<T> = {
  success: boolean;
  data: T;
  message?: string;
};

type WizardStepId = "session" | "students" | "photos" | "matching" | "qc" | "processing";

const WIZARD_STEPS: Array<{
  id: WizardStepId;
  label: string;
  description: string;
}> = [
  { id: "session", label: "Session", description: "Buat/import data" },
  { id: "students", label: "Data Siswa", description: "Preview Excel" },
  { id: "photos", label: "Foto RAW", description: "Scan folder kamera" },
  { id: "matching", label: "Matching", description: "Cek pasangan foto" },
  { id: "processing", label: "Process Foto", description: "Remove BG + warna" },
  { id: "qc", label: "Output Cetak", description: "Rename final + QC" },
];

function stepFromSessionStatus(status?: string): WizardStepId {
  if (!status || status === "DRAFT") {
    return "session";
  }

  if (status === "DATA_IMPORTED") {
    return "students";
  }

  if (status === "PHOTO_MATCHED" || status === "PROCESSING" || status === "READY") {
    return "processing";
  }

  if (status === "RENAMED" || status === "REVIEW") {
    return "qc";
  }

  return "session";
}

export default function App() {
  const [schoolName, setSchoolName] = useState("");
  const [photoDate, setPhotoDate] = useState("");
  const [period, setPeriod] = useState("2026 / 2027");
  const [file, setFile] = useState<File | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [photoFolderPath, setPhotoFolderPath] = useState("");
  const [photoSummary, setPhotoSummary] = useState<PhotoSummary | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [matchSummary, setMatchSummary] = useState<MatchSummary | null>(null);
  const [matchItems, setMatchItems] = useState<MatchItem[]>([]);
  const [matchFilter, setMatchFilter] = useState<"ALL" | MatchStatus>("ALL");
  const [renameSummary, setRenameSummary] = useState<RenameSummary | null>(null);
  const [renameFilter, setRenameFilter] = useState<"ALL" | "PENDING" | "DONE" | "FAILED">("ALL");
  const [qcSummary, setQcSummary] = useState<QcSummary | null>(null);
  const [renamedItems, setRenamedItems] = useState<RenamedItem[]>([]);
  const [qcFilter, setQcFilter] = useState<"ALL" | QcStatus>("ALL");
  const [manifest, setManifest] = useState<ManifestResult | null>(null);
  const [processingSummary, setProcessingSummary] = useState<ProcessingSummary | null>(null);
  const [processingItems, setProcessingItems] = useState<ProcessingItem[]>([]);
  const [processRunSummary, setProcessRunSummary] = useState<ProcessRunSummary | null>(null);
  const [backgroundColor, setBackgroundColor] = useState("#FFFFFF");
  const [backgroundMode, setBackgroundMode] = useState<"FILL" | "NO_FILL">("FILL");
  const [loading, setLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [matchLoading, setMatchLoading] = useState(false);
  const [renameLoading, setRenameLoading] = useState(false);
  const [qcLoadingId, setQcLoadingId] = useState<number | null>(null);
  const [processingLoading, setProcessingLoading] = useState(false);
  const [processingResetId, setProcessingResetId] = useState<number | null>(null);
  const [activeStep, setActiveStep] = useState<WizardStepId>("session");
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadSessions().catch((error) => {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Gagal memuat session");
    });
  }, []);

  async function readJson<T>(response: Response): Promise<ApiResponse<T>> {
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Request gagal");
    }

    return result;
  }

  async function loadStudents(sessionId: number) {
    const response = await fetch(`${API_URL}/api/sessions/${sessionId}/students?limit=100`);
    const result = await readJson<{
      total: number;
      valid: number;
      invalid: number;
      columns: string[];
      students: Student[];
    }>(response);

    setColumns(result.data.columns);
    setStudents(result.data.students);
  }

  async function loadSessions() {
    const response = await fetch(`${API_URL}/api/sessions`);
    const result = await readJson<Session[]>(response);

    setSessions(result.data);
  }

  async function loadRenamedItems(sessionId: number) {
    const response = await fetch(`${API_URL}/api/sessions/${sessionId}/renamed-items`);
    const result = await readJson<{
      summary: QcSummary;
      items: RenamedItem[];
    }>(response);

    setQcSummary(result.data.summary);
    setRenamedItems(result.data.items);
  }

  async function loadProcessingItems(sessionId: number) {
    const response = await fetch(`${API_URL}/api/sessions/${sessionId}/processing-items`);
    const result = await readJson<{
      summary: ProcessingSummary;
      items: ProcessingItem[];
    }>(response);

    setProcessingSummary(result.data.summary);
    setProcessingItems(result.data.items);
  }

  async function loadSessionDetail(sessionId: number) {
    try {
      setSessionLoading(true);
      setMessage("");
      setSummary(null);
      setPhotoSummary(null);
      setPhotos([]);
      setMatchSummary(null);
      setMatchItems([]);
      setRenameSummary(null);
      setQcSummary(null);
      setRenamedItems([]);
      setProcessingSummary(null);
      setProcessingItems([]);
      setProcessRunSummary(null);
      setManifest(null);
      setQcSummary(null);
      setRenamedItems([]);
      setManifest(null);
      setProcessingSummary(null);
      setProcessingItems([]);
      setProcessRunSummary(null);
      setManifest(null);
      setManifest(null);

      const sessionResponse = await fetch(`${API_URL}/api/sessions/${sessionId}`);
      const sessionResult = await readJson<
        Session & {
          imported_count: number;
          invalid_count: number;
          import_sheet_name: string | null;
          import_header_row: number | null;
          import_columns: string | null;
          total_students: number;
        }
      >(sessionResponse);
      const selectedSession = sessionResult.data;

      setSession(selectedSession);
      setSchoolName(selectedSession.school_name);
      setPhotoDate(selectedSession.photo_date || "");
      setPeriod(selectedSession.period || "");
      setActiveStep(stepFromSessionStatus(selectedSession.status));
      await loadStudents(sessionId);

      if (selectedSession.import_sheet_name) {
        setSummary({
          total: selectedSession.total_students || 0,
          valid: selectedSession.imported_count || 0,
          invalid: selectedSession.invalid_count || 0,
          sheet_name: selectedSession.import_sheet_name,
          header_row_number: selectedSession.import_header_row || 0,
          columns: JSON.parse(selectedSession.import_columns || "[]"),
          mapping: {},
        });
      }

      const photosResponse = await fetch(`${API_URL}/api/sessions/${sessionId}/photos?limit=100`);
      const photosResult = await readJson<{
        source: { folder_path: string; total_files: number } | null;
        total: number;
        raster: number;
        raw: number;
        photos: Photo[];
      }>(photosResponse);

      setPhotos(photosResult.data.photos);

      if (photosResult.data.source) {
        setPhotoFolderPath(photosResult.data.source.folder_path);
        setPhotoSummary({
          folder_path: photosResult.data.source.folder_path,
          total: photosResult.data.total,
          preview: photosResult.data.photos,
        });
      }

      if (["PHOTO_MATCHED", "PROCESSING", "READY", "RENAMED", "REVIEW", "READY_FOR_PROCESSING"].includes(selectedSession.status)) {
        const matchingResponse = await fetch(`${API_URL}/api/sessions/${sessionId}/matching`);
        const matchingResult = await readJson<unknown>(matchingResponse) as unknown as {
          summary: MatchSummary;
          items: MatchItem[];
        };

        setMatchSummary(matchingResult.summary);
        setMatchItems(matchingResult.items);
      }

      if (["RENAMED", "REVIEW", "READY_FOR_PROCESSING"].includes(selectedSession.status)) {
        await loadRenamedItems(sessionId);
      }

      if (["PHOTO_MATCHED", "PROCESSING", "READY", "READY_FOR_PROCESSING"].includes(selectedSession.status)) {
        await loadProcessingItems(sessionId);
      }
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Gagal membuka session");
    } finally {
      setSessionLoading(false);
    }
  }

  async function handleCreateSession() {
    if (!schoolName || !file) {
      setMessage("Nama sekolah dan file Excel wajib diisi.");
      return;
    }

    try {
      setLoading(true);
      setMessage("");
      setSession(null);
      setSummary(null);
      setColumns([]);
      setStudents([]);
      setPhotoSummary(null);
      setPhotos([]);
      setMatchSummary(null);
      setMatchItems([]);
      setRenameSummary(null);

      const sessionResponse = await fetch(`${API_URL}/api/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          school_name: schoolName,
          photo_date: photoDate || null,
          period,
        }),
      });
      const sessionResult = await readJson<Session>(sessionResponse);
      const formData = new FormData();

      formData.append("file", file);

      const importResponse = await fetch(
        `${API_URL}/api/sessions/${sessionResult.data.id}/import-xlsx`,
        {
          method: "POST",
          body: formData,
        }
      );
      const importResult = await readJson<ImportSummary>(importResponse);

      setSession({ ...sessionResult.data, status: "DATA_IMPORTED" });
      setSummary(importResult.data);
      await loadStudents(sessionResult.data.id);
      await loadSessions();
      setActiveStep("students");
      setMessage(`Session ${sessionResult.data.session_code} berhasil dibuat dan data siswa sudah diimport.`);
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Terjadi error tidak dikenal");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegisterPhotoSource() {
    if (!session || !photoFolderPath) {
      setMessage("Session dan path folder foto wajib diisi.");
      return;
    }

    try {
      setPhotoLoading(true);
      setMessage("");
      setPhotoSummary(null);
      setPhotos([]);

      const response = await fetch(`${API_URL}/api/sessions/${session.id}/photo-source`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          folder_path: photoFolderPath,
        }),
      });
      const result = await readJson<PhotoSummary>(response);
      const photosResponse = await fetch(`${API_URL}/api/sessions/${session.id}/photos?limit=100`);
      const photosResult = await readJson<{
        source: unknown;
        total: number;
        raster: number;
        raw: number;
        photos: Photo[];
      }>(photosResponse);

      setPhotoSummary(result.data);
      setPhotos(photosResult.data.photos);
      setSession({ ...session, total_photos: result.data.total });
      setMatchSummary(null);
      setMatchItems([]);
      setRenameSummary(null);
      setQcSummary(null);
      setRenamedItems([]);
      setProcessingSummary(null);
      setProcessingItems([]);
      setProcessRunSummary(null);
      setActiveStep("matching");
      setMessage(`Folder foto terdaftar: ${result.data.total} file ditemukan.`);
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Terjadi error tidak dikenal");
    } finally {
      setPhotoLoading(false);
    }
  }

  async function handleRunMatching() {
    if (!session) {
      setMessage("Session belum tersedia.");
      return;
    }

    try {
      setMatchLoading(true);
      setMessage("");
      setRenameSummary(null);

      const response = await fetch(`${API_URL}/api/sessions/${session.id}/match-photos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const result = await readJson<unknown>(response) as unknown as {
        success: boolean;
        summary: MatchSummary;
        items: MatchItem[];
      };

      setMatchSummary(result.summary);
      setMatchItems(result.items);
      setSession({ ...session, status: "PHOTO_MATCHED" });
      await loadProcessingItems(session.id);
      setActiveStep("processing");
      setMessage(`Matching selesai: ${result.summary.matched} foto cocok.`);
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Terjadi error tidak dikenal");
    } finally {
      setMatchLoading(false);
    }
  }

  async function handleRename() {
    if (!session) {
      setMessage("Session belum tersedia.");
      return;
    }

    const readyCount = processingSummary?.ready || matchSummary?.matched || 0;
    const confirmed = window.confirm(
      `${readyCount} file hasil processing siap dibuat output cetak.\n\nSistem akan membuat 2 folder: nama murid dan serial No Foto.`
    );

    if (!confirmed) {
      return;
    }

    try {
      setRenameLoading(true);
      setMessage("");

      const response = await fetch(`${API_URL}/api/sessions/${session.id}/rename`, {
        method: "POST",
      });
      const result = await readJson<unknown>(response) as unknown as {
        success: boolean;
        summary: RenameSummary;
      };

      setRenameSummary(result.summary);
      setSession({ ...session, status: result.summary.failed === 0 ? "RENAMED" : "REVIEW" });
      await loadStudents(session.id);
      await loadSessionDetail(session.id);
      await loadRenamedItems(session.id);
      setActiveStep("qc");
      setMessage(`${result.summary.renamed} berhasil, ${result.summary.failed} gagal, ${result.summary.skipped} dilewati.`);
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Terjadi error tidak dikenal");
    } finally {
      setRenameLoading(false);
    }
  }

  async function handleCreateManifest() {
    if (!session) {
      setMessage("Session belum tersedia.");
      return;
    }

    try {
      setMessage("");

      const response = await fetch(`${API_URL}/api/sessions/${session.id}/manifest`, {
        method: "POST",
      });
      const result = await readJson<ManifestResult>(response);

      setManifest(result.data);
      setMessage(`Manifest dibuat: ${result.data.path}`);
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Gagal membuat manifest");
    }
  }

  async function handleUpdateQc(studentId: number, qcStatus: QcStatus) {
    if (!session) {
      return;
    }

    try {
      setQcLoadingId(studentId);
      setMessage("");

      const response = await fetch(`${API_URL}/api/sessions/${session.id}/renamed-items/${studentId}/qc`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          qc_status: qcStatus,
        }),
      });

      await readJson<RenamedItem>(response);
      await loadRenamedItems(session.id);
      await loadStudents(session.id);
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Gagal update QC");
    } finally {
      setQcLoadingId(null);
    }
  }

  async function handleApproveAllPending() {
    if (!session) {
      return;
    }

    const pendingItems = renamedItems.filter((item) => item.qc_status === "PENDING");

    try {
      setMessage("");

      for (const item of pendingItems) {
        await fetch(`${API_URL}/api/sessions/${session.id}/renamed-items/${item.id}/qc`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            qc_status: "APPROVED",
          }),
        });
      }

      await loadRenamedItems(session.id);
      await loadStudents(session.id);
      setMessage(`${pendingItems.length} item pending disetujui.`);
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Gagal approve semua pending");
    }
  }

  async function handleRunProcessing() {
    if (!session) {
      return;
    }

    try {
      setProcessingLoading(true);
      setMessage("");

      const response = await fetch(`${API_URL}/api/sessions/${session.id}/process`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          limit: 1,
          background_color: backgroundMode === "NO_FILL" ? "NO_FILL" : backgroundColor,
        }),
      });
      const result = await readJson<unknown>(response) as unknown as {
        success: boolean;
        summary: ProcessRunSummary;
        remaining: number;
      };

      setProcessRunSummary(result.summary);
      await loadProcessingItems(session.id);
      await loadSessions();
      setMessage(`Processing selesai: ${result.summary.processed} ready, ${result.summary.failed} gagal, ${result.remaining} tersisa.`);
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Gagal menjalankan processing");
    } finally {
      setProcessingLoading(false);
    }
  }

  async function handleResetProcessingItem(studentId: number) {
    if (!session) {
      return;
    }

    const confirmed = window.confirm(
      "Reset item ini? File processing, output nama, output serial, dan status QC item ini akan dikosongkan."
    );

    if (!confirmed) {
      return;
    }

    try {
      setProcessingResetId(studentId);
      setMessage("");

      const response = await fetch(`${API_URL}/api/sessions/${session.id}/processing-items/${studentId}/reset`, {
        method: "POST",
      });

      await readJson<ProcessingItem>(response);
      await loadProcessingItems(session.id);
      await loadRenamedItems(session.id).catch(() => undefined);
      await loadStudents(session.id);
      await loadSessions();
      setSession({ ...session, status: "PROCESSING" });
      setMessage("Item direset. Silakan process ulang dengan mode/background yang benar.");
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Gagal reset item");
    } finally {
      setProcessingResetId(null);
    }
  }

  const filteredMatchItems = matchItems.filter((item) =>
    matchFilter === "ALL" ? true : item.status === matchFilter
  );
  const filteredRenameStudents = students.filter((student) =>
    renameFilter === "ALL" ? true : student.rename_status === renameFilter
  );
  const filteredQcItems = renamedItems.filter((item) =>
    qcFilter === "ALL" ? true : item.qc_status === qcFilter
  );
  const activeStepIndex = WIZARD_STEPS.findIndex((step) => step.id === activeStep);
  const activeStepConfig = WIZARD_STEPS[activeStepIndex] || WIZARD_STEPS[0];
  const canOpenStep = (stepId: WizardStepId) => {
    if (stepId === "session") return true;
    if (stepId === "students") return Boolean(summary || students.length > 0);
    if (stepId === "photos") return Boolean(summary || students.length > 0);
    if (stepId === "matching") return Boolean(photoSummary || matchSummary);
    if (stepId === "qc") return renamedItems.length > 0 || ["RENAMED", "REVIEW", "READY_FOR_PROCESSING"].includes(session?.status || "");
    if (stepId === "processing") return Boolean(processingSummary) || ["PHOTO_MATCHED", "PROCESSING", "READY", "REVIEW", "RENAMED"].includes(session?.status || "");
    return false;
  };
  const goNextStep = () => {
    const nextStep = WIZARD_STEPS.slice(activeStepIndex + 1).find((step) => canOpenStep(step.id));

    if (nextStep) {
      setActiveStep(nextStep.id);
    }
  };
  const goPreviousStep = () => {
    const previousSteps = WIZARD_STEPS.slice(0, activeStepIndex).reverse();
    const previousStep = previousSteps.find((step) => canOpenStep(step.id));

    if (previousStep) {
      setActiveStep(previousStep.id);
    }
  };
  const hasPreviousStep = WIZARD_STEPS.slice(0, activeStepIndex).some((step) => canOpenStep(step.id));
  const hasNextStep = WIZARD_STEPS.slice(activeStepIndex + 1).some((step) => canOpenStep(step.id));

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900">
      <div className="flex min-h-screen w-full">
        <aside className="w-56 shrink-0 bg-slate-950 px-4 py-6 text-white">
          <div className="mb-10 flex items-center gap-3 px-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-600 text-sm font-bold">
              SP
            </div>

            <div>
              <div className="text-sm font-semibold">STELA Production</div>
              <div className="text-xs text-slate-500">Photo Workflow</div>
            </div>
          </div>

          <nav className="space-y-2">
            {WIZARD_STEPS.map((step, index) => {
              const isActive = activeStep === step.id;
              const isEnabled = canOpenStep(step.id);

              return (
                <button
                  key={step.id}
                  onClick={() => isEnabled && setActiveStep(step.id)}
                  disabled={!isEnabled}
                  className={`grid w-full grid-cols-[28px_1fr] items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                    isActive
                      ? "bg-white text-slate-950"
                      : isEnabled
                        ? "text-slate-300 hover:bg-white/10 hover:text-white"
                        : "cursor-not-allowed text-slate-600"
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                      isActive
                        ? "bg-red-600 text-white"
                        : isEnabled
                          ? "bg-white/10 text-slate-200"
                          : "bg-white/5 text-slate-600"
                    }`}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{step.label}</span>
                    <span className={`block truncate text-[11px] ${isActive ? "text-slate-500" : "text-slate-500"}`}>
                      {step.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="mt-8 border-t border-white/10 pt-5">
            <div className="mb-3 px-2 text-xs font-semibold uppercase text-slate-500">
              History / riwayat
            </div>
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {sessions.map((item) => (
                <button
                  key={item.id}
                  onClick={() => loadSessionDetail(item.id)}
                  className={`w-full rounded-xl px-3 py-3 text-left text-xs transition ${
                    session?.id === item.id
                      ? "bg-white/10 text-white"
                      : "text-slate-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <div className="truncate font-semibold">{item.school_name}</div>
                  <div className="mt-1 truncate text-[11px] text-slate-500">
                    {item.session_code}
                  </div>
                  <div className="mt-1 text-[11px] font-semibold text-slate-300">
                    {item.status}
                  </div>
                </button>
              ))}
              {sessions.length === 0 && (
                <div className="px-2 text-xs text-slate-500">
                  Belum ada Riwayat.
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="w-full px-10 py-8">
            <header className="mb-8 flex items-center justify-between border-b border-slate-200 pb-6">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-red-600">
                  Step {activeStepIndex + 1} / {WIZARD_STEPS.length}
                </p>
                <h1 className="text-3xl font-bold tracking-tight">{activeStepConfig.label}</h1>
                <p className="mt-2 text-sm text-slate-500">
                  {activeStepConfig.description}
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {sessionLoading ? "Loading Session" : "Local API"}
              </div>
            </header>

            {activeStep === "session" && (
            <div className="grid grid-cols-12 gap-8">
              <section className="col-span-8">
                <div className="mb-6">
                  <h2 className="text-lg font-semibold">Informasi Sesi</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Data dasar sesi pemotretan.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-5">
                  <div className="col-span-2">
                    <label className="mb-2 block text-sm font-medium">Nama Sekolah</label>
                    <input
                      value={schoolName}
                      onChange={(event) => setSchoolName(event.target.value)}
                      placeholder="Contoh: SD Alzhar"
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-50"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium">Tanggal Pemotretan</label>
                    <input
                      type="date"
                      value={photoDate}
                      onChange={(event) => setPhotoDate(event.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-50"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium">Periode Produksi</label>
                    <input
                      value={period}
                      onChange={(event) => setPeriod(event.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-50"
                    />
                  </div>
                </div>
              </section>

              <section className="col-span-4">
                <div className="mb-6">
                  <h2 className="text-lg font-semibold">Data Siswa</h2>
                  <p className="mt-1 text-sm text-slate-500">Upload file XLSX atau XLS.</p>
                </div>

                <label className="flex h-56 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-white px-6 text-center transition hover:border-red-400 hover:bg-red-50/30">
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(event) => setFile(event.target.files?.[0] || null)}
                  />

                  <div className="mb-3 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold uppercase text-slate-500">
                    XLSX
                  </div>
                  <div className="max-w-full truncate text-sm font-semibold">
                    {file ? file.name : "Pilih file Excel"}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    Header akan dideteksi otomatis.
                  </div>
                </label>

                {file && (
                  <button
                    onClick={() => setFile(null)}
                    className="mt-3 text-xs font-semibold text-red-600"
                  >
                    Hapus file
                  </button>
                )}
              </section>
            </div>
            )}

            {message && (
              <div className="mt-6 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
                {message}
              </div>
            )}

            {activeStep === "session" && (
            <div className="mt-8 flex justify-end border-t border-slate-200 pt-6">
              <button
                onClick={handleCreateSession}
                disabled={!schoolName || !file || loading}
                className="rounded-xl bg-red-600 px-7 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
              >
                {loading ? "Mengimport..." : "Buat Session + Import XLSX"}
              </button>
            </div>
            )}

            {summary && activeStep === "students" && (
              <section className="mt-8">
                <div className="mb-4 flex items-end justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">Student Preview</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {session?.session_code} - {summary.sheet_name}, header row {summary.header_row_number}
                    </p>
                  </div>
                  <div className="text-sm font-semibold text-slate-600">
                    Status: {session?.status || "DATA_IMPORTED"}
                  </div>
                </div>

                <div className="mb-5 grid grid-cols-3 gap-4">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="text-xs font-medium uppercase text-slate-400">Total</div>
                    <div className="mt-1 text-2xl font-bold">{summary.total}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="text-xs font-medium uppercase text-slate-400">Valid</div>
                    <div className="mt-1 text-2xl font-bold text-emerald-600">{summary.valid}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="text-xs font-medium uppercase text-slate-400">Invalid</div>
                    <div className="mt-1 text-2xl font-bold text-red-600">{summary.invalid}</div>
                  </div>
                </div>
                {summary.duplicate_photo_numbers ? (
                  <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                    {summary.duplicate_photo_numbers} data memiliki No Foto duplicate.
                  </div>
                ) : null}

                <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="mb-3 text-sm font-semibold">Kolom Workflow Terdeteksi</div>
                  <div className="grid grid-cols-4 gap-3 text-xs">
                    {Object.entries(summary.mapping).map(([field, header]) => (
                      <div key={field} className="rounded-lg bg-slate-50 px-3 py-2">
                        <div className="font-semibold text-slate-700">{field}</div>
                        <div className="mt-1 text-slate-500">{header}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full min-w-[1200px] border-collapse text-left text-sm">
                    <thead className="bg-slate-100 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="sticky left-0 z-10 bg-slate-100 px-4 py-3">Row</th>
                        {columns.map((column) => (
                          <th key={column} className="max-w-[260px] whitespace-nowrap px-4 py-3">
                            {column}
                          </th>
                        ))}
                        <th className="px-4 py-3">Validasi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {students.map((student) => (
                        <tr key={student.id}>
                          <td className="sticky left-0 bg-white px-4 py-3 text-slate-500">
                            {student.import_row_number}
                          </td>
                          {columns.map((column) => (
                            <td key={column} className="max-w-[260px] whitespace-nowrap px-4 py-3">
                              {student.raw_data[column] || "-"}
                            </td>
                          ))}
                          <td className="px-4 py-3">
                            {student.is_valid ? (
                              <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                                VALID
                              </span>
                            ) : (
                              <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">
                                {student.validation_errors}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {summary && activeStep === "photos" && (
              <section className="mt-8 border-t border-slate-200 pt-8">
                <div className="mb-5 flex items-end justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">Photo Source</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Register folder kamera lokal. File disimpan sebagai path, bukan dicopy.
                    </p>
                  </div>
                  {photoSummary && (
                    <div className="text-sm font-semibold text-slate-600">
                      {photoSummary.total} file
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-[1fr_auto] gap-3">
                  <input
                    value={photoFolderPath}
                    onChange={(event) => setPhotoFolderPath(event.target.value)}
                    placeholder="Contoh: D:\\CAMERA\\SD_ALZHAR_2026"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-50"
                  />
                  <button
                    onClick={handleRegisterPhotoSource}
                    disabled={!photoFolderPath || photoLoading}
                    className="rounded-xl bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                  >
                    {photoLoading ? "Scanning..." : "Scan Folder"}
                  </button>
                </div>

                {photoSummary && (
                  <div className="mt-5 rounded-xl border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 px-4 py-3 text-sm">
                      <div className="font-semibold">Folder terdaftar</div>
                      <div className="mt-1 break-all text-xs text-slate-500">
                        {photoSummary.folder_path}
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                        <thead className="bg-slate-100 text-xs uppercase text-slate-500">
                          <tr>
                            <th className="px-4 py-3">Filename</th>
                            <th className="px-4 py-3">Ext</th>
                            <th className="px-4 py-3">Size</th>
                            <th className="px-4 py-3">Path</th>
                            <th className="px-4 py-3">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {photos.map((photo) => (
                            <tr key={photo.id || photo.source_path}>
                              <td className="whitespace-nowrap px-4 py-3 font-medium">
                                {photo.filename}
                              </td>
                              <td className="px-4 py-3">{photo.extension}</td>
                              <td className="px-4 py-3 text-slate-500">
                                {(photo.file_size / 1024 / 1024).toFixed(2)} MB
                              </td>
                              <td className="max-w-[520px] truncate px-4 py-3 text-slate-500">
                                {photo.source_path}
                              </td>
                              <td className="px-4 py-3">
                                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                                  {photo.photo_status || "REGISTERED"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </section>
            )}

            {photoSummary && activeStep === "matching" && (
              <section className="mt-8 border-t border-slate-200 pt-8">
                <div className="mb-5 flex items-end justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">Matching Preview</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Cocokkan No Foto dari Excel dengan angka terakhir pada filename kamera.
                    </p>
                  </div>
                  <button
                    onClick={handleRunMatching}
                    disabled={matchLoading}
                    className="rounded-xl bg-red-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                  >
                    {matchLoading ? "Matching..." : "Run Matching"}
                  </button>
                </div>

                {matchSummary && (
                  <>
                    <div className="mb-5 grid grid-cols-6 gap-4">
                      <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="text-xs font-medium uppercase text-slate-400">Total Data</div>
                        <div className="mt-1 text-2xl font-bold">{matchSummary.total_students}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="text-xs font-medium uppercase text-slate-400">Foto Folder</div>
                        <div className="mt-1 text-2xl font-bold">{matchSummary.total_photos}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="text-xs font-medium uppercase text-slate-400">Matched</div>
                        <div className="mt-1 text-2xl font-bold text-emerald-600">{matchSummary.matched}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="text-xs font-medium uppercase text-slate-400">Missing</div>
                        <div className="mt-1 text-2xl font-bold text-amber-600">{matchSummary.photo_missing}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="text-xs font-medium uppercase text-slate-400">Tidak Ada Data</div>
                        <div className="mt-1 text-2xl font-bold text-slate-600">{matchSummary.data_not_found}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="text-xs font-medium uppercase text-slate-400">Conflict</div>
                        <div className="mt-1 text-2xl font-bold text-red-600">
                          {matchSummary.conflicts + matchSummary.duplicates}
                        </div>
                      </div>
                    </div>

                    <div className="mb-4 flex flex-wrap gap-2">
                      {[
                        ["ALL", "Semua"],
                        ["MATCHED", "Matched"],
                        ["PHOTO_MISSING", "Missing"],
                        ["DATA_NOT_FOUND", "Tidak Ada Data"],
                        ["DUPLICATE_NUMBER", "Duplicate"],
                        ["FILENAME_CONFLICT", "Conflict"],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => setMatchFilter(value as "ALL" | MatchStatus)}
                          className={`rounded-full px-3 py-2 text-xs font-semibold ${
                            matchFilter === value
                              ? "bg-slate-950 text-white"
                              : "bg-white text-slate-600 ring-1 ring-slate-200"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                      <table className="w-full min-w-[1000px] border-collapse text-left text-sm">
                        <thead className="bg-slate-100 text-xs uppercase text-slate-500">
                          <tr>
                            <th className="px-4 py-3">No Foto</th>
                            <th className="px-4 py-3">File Kamera</th>
                            <th className="px-4 py-3">Nama Siswa</th>
                            <th className="px-4 py-3">Nama Output</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3">Catatan</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {filteredMatchItems.map((item, index) => (
                            <tr key={`${item.type}-${item.student_id || item.photo_id || index}`}>
                              <td className="px-4 py-3 font-medium">{item.photo_number || "-"}</td>
                              <td className="px-4 py-3">{item.original_filename || "-"}</td>
                              <td className="px-4 py-3">{item.student_name || "-"}</td>
                              <td className="px-4 py-3">{item.final_filename || "-"}</td>
                              <td className="px-4 py-3">
                                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                                  {item.status}
                                </span>
                              </td>
                              <td className="max-w-[360px] px-4 py-3 text-slate-500">
                                {item.notes || "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-5 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-4">
                      <div>
                        <div className="text-sm font-semibold">{matchSummary.matched} file siap masuk processing</div>
                        <div className="mt-1 text-xs text-slate-500">Rename final dibuat setelah background selesai diproses.</div>
                      </div>
                      <button
                        onClick={() => setActiveStep("processing")}
                        disabled={matchSummary.matched === 0}
                        className="rounded-xl bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                      >
                        Lanjut Process Foto
                      </button>
                    </div>

                    {renameSummary && (
                      <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
                        Rename result: {renameSummary.renamed} berhasil, {renameSummary.failed} gagal, {renameSummary.skipped} dilewati.
                      </div>
                    )}
                  </>
                )}
              </section>
            )}

            {session && activeStep === "qc" && ["RENAMED", "REVIEW"].includes(session.status) && (
              <section className="mt-8 border-t border-slate-200 pt-8">
                <div className="mb-5 flex items-end justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">Rename Result</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Status copy + rename per siswa, termasuk path tujuan hasil output.
                    </p>
                  </div>
                  <button
                    onClick={handleCreateManifest}
                    className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
                  >
                    Buat Manifest
                  </button>
                </div>

                <div className="mb-4 flex flex-wrap gap-2">
                  {[
                    ["ALL", "Semua"],
                    ["DONE", "Done"],
                    ["FAILED", "Failed"],
                    ["PENDING", "Pending"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setRenameFilter(value as "ALL" | "PENDING" | "DONE" | "FAILED")}
                      className={`rounded-full px-3 py-2 text-xs font-semibold ${
                        renameFilter === value
                          ? "bg-slate-950 text-white"
                          : "bg-white text-slate-600 ring-1 ring-slate-200"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full min-w-[1350px] border-collapse text-left text-sm">
                    <thead className="bg-slate-100 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3">No Foto</th>
                        <th className="px-4 py-3">Nama Siswa</th>
                        <th className="px-4 py-3">File Kamera</th>
                        <th className="px-4 py-3">Output Nama Murid</th>
                        <th className="px-4 py-3">Output Serial</th>
                        <th className="px-4 py-3">Rename</th>
                        <th className="px-4 py-3">Folder Nama</th>
                        <th className="px-4 py-3">Folder Serial</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {filteredRenameStudents.map((student) => (
                        <tr key={student.id}>
                          <td className="px-4 py-3 font-medium">{student.photo_number || "-"}</td>
                          <td className="px-4 py-3">{student.student_name || "-"}</td>
                          <td className="px-4 py-3">{student.original_filename || "-"}</td>
                          <td className="px-4 py-3">{student.final_filename || "-"}</td>
                          <td className="px-4 py-3">{student.serial_filename || "-"}</td>
                          <td className="px-4 py-3">
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                              {student.rename_status}
                            </span>
                          </td>
                          <td className="max-w-[520px] truncate px-4 py-3 text-slate-500">
                            {student.destination_path || "-"}
                          </td>
                          <td className="max-w-[520px] truncate px-4 py-3 text-slate-500">
                            {student.serial_path || "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {manifest && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
                    Manifest: {manifest.total_rows} row - <span className="break-all text-slate-500">{manifest.path}</span>
                  </div>
                )}
              </section>
            )}

            {renamedItems.length > 0 && activeStep === "qc" && (
              <section className="mt-8 border-t border-slate-200 pt-8">
                <div className="mb-5 flex items-end justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">QC Hasil Rename</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Cek thumbnail output sebelum masuk processing.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleApproveAllPending}
                      disabled={!qcSummary || qcSummary.pending === 0}
                      className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      Approve Pending
                    </button>
                  </div>
                </div>

                {qcSummary && (
                  <div className="mb-5 grid grid-cols-3 gap-3 lg:grid-cols-6">
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-xs font-medium uppercase text-slate-400">Done</div>
                      <div className="text-xl font-bold">{qcSummary.done}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-xs font-medium uppercase text-slate-400">Approved</div>
                      <div className="text-xl font-bold text-emerald-600">{qcSummary.approved}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-xs font-medium uppercase text-slate-400">Pending</div>
                      <div className="text-xl font-bold text-slate-600">{qcSummary.pending}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-xs font-medium uppercase text-slate-400">Review</div>
                      <div className="text-xl font-bold text-amber-600">{qcSummary.needs_review}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-xs font-medium uppercase text-slate-400">Rejected</div>
                      <div className="text-xl font-bold text-red-600">{qcSummary.rejected}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-xs font-medium uppercase text-slate-400">Failed</div>
                      <div className="text-xl font-bold text-red-600">{qcSummary.failed}</div>
                    </div>
                  </div>
                )}

                <div className="mb-4 flex flex-wrap gap-2">
                  {[
                    ["ALL", "Semua"],
                    ["PENDING", "Pending"],
                    ["APPROVED", "Approved"],
                    ["NEEDS_REVIEW", "Review"],
                    ["REJECTED", "Rejected"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setQcFilter(value as "ALL" | QcStatus)}
                      className={`rounded-full px-3 py-2 text-xs font-semibold ${
                        qcFilter === value
                          ? "bg-slate-950 text-white"
                          : "bg-white text-slate-600 ring-1 ring-slate-200"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
                  {filteredQcItems.map((item) => (
                    <div
                      key={item.id}
                      className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
                    >
                      <div className="relative flex aspect-[4/3] items-center justify-center bg-slate-100">
                        {item.rename_status === "DONE" ? (
                          <img
                            src={`${API_URL}/api/sessions/${session?.id}/renamed-items/${item.id}/image`}
                            alt={item.student_name}
                            className="max-h-full max-w-full object-contain"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-sm text-slate-400">
                            File gagal
                          </div>
                        )}
                        <span
                          className={`absolute right-2 top-2 rounded-full px-2 py-1 text-[10px] font-bold ${
                            item.qc_status === "APPROVED"
                              ? "bg-emerald-600 text-white"
                              : item.qc_status === "NEEDS_REVIEW"
                                ? "bg-amber-500 text-white"
                                : item.qc_status === "REJECTED"
                                  ? "bg-red-600 text-white"
                                  : "bg-white text-slate-700 ring-1 ring-slate-200"
                          }`}
                        >
                          {item.qc_status}
                        </span>
                      </div>
                      <div className="space-y-3 p-3">
                        <div>
                          <div className="truncate text-sm font-semibold text-slate-950">
                            {item.student_name}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] font-medium text-slate-500">
                            <span>{item.photo_number || "-"}</span>
                            <span className="h-1 w-1 rounded-full bg-slate-300" />
                            <span>{item.class_name || "-"}</span>
                          </div>
                        </div>

                        <div className="truncate rounded-md bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">
                          {item.final_filename || "-"}
                        </div>

                        <div className="truncate rounded-md bg-red-50 px-2 py-1.5 text-[11px] font-semibold text-red-700">
                          Serial: {item.serial_filename || "-"}
                        </div>

                        <div className="grid grid-cols-3 overflow-hidden rounded-md border border-slate-200 bg-white">
                          <button
                            type="button"
                            onClick={() => handleUpdateQc(item.id, "APPROVED")}
                            disabled={qcLoadingId === item.id}
                            className={`h-9 px-2 text-[11px] font-bold transition disabled:cursor-wait disabled:bg-slate-100 disabled:text-slate-400 ${
                              item.qc_status === "APPROVED"
                                ? "bg-emerald-600 text-white"
                                : "bg-white text-slate-600 hover:bg-emerald-50 hover:text-emerald-700"
                            }`}
                          >
                            OK
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateQc(item.id, "NEEDS_REVIEW")}
                            disabled={qcLoadingId === item.id}
                            className={`h-9 border-x border-slate-200 px-2 text-[11px] font-bold transition disabled:cursor-wait disabled:bg-slate-100 disabled:text-slate-400 ${
                              item.qc_status === "NEEDS_REVIEW"
                                ? "bg-amber-500 text-white"
                                : "bg-white text-slate-600 hover:bg-amber-50 hover:text-amber-700"
                            }`}
                          >
                            Cek
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateQc(item.id, "REJECTED")}
                            disabled={qcLoadingId === item.id}
                            className={`h-9 px-2 text-[11px] font-bold transition disabled:cursor-wait disabled:bg-slate-100 disabled:text-slate-400 ${
                              item.qc_status === "REJECTED"
                                ? "bg-red-600 text-white"
                                : "bg-white text-slate-600 hover:bg-red-50 hover:text-red-700"
                            }`}
                          >
                            Tolak
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {session && activeStep === "processing" && ["PHOTO_MATCHED", "PROCESSING", "READY", "REVIEW", "RENAMED"].includes(session.status) && (
              <section className="mt-8 border-t border-slate-200 pt-8">
                <div className="mb-5 flex items-end justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">Process Foto</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Remove background atau No Fill, lalu simpan JPG RGB portrait 3:4 ke folder processing.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-slate-200 bg-white text-xs font-bold">
                      <button
                        type="button"
                        onClick={() => setBackgroundMode("FILL")}
                        className={`px-3 py-2 transition ${
                          backgroundMode === "FILL"
                            ? "bg-slate-950 text-white"
                            : "text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        Fill
                      </button>
                      <button
                        type="button"
                        onClick={() => setBackgroundMode("NO_FILL")}
                        className={`border-l border-slate-200 px-3 py-2 transition ${
                          backgroundMode === "NO_FILL"
                            ? "bg-slate-950 text-white"
                            : "text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        No Fill
                      </button>
                    </div>
                    {backgroundMode === "FILL" && (
                      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <input
                          type="color"
                          value={backgroundColor}
                          onChange={(event) => setBackgroundColor(event.target.value.toUpperCase())}
                          className="h-8 w-10 cursor-pointer border-0 bg-transparent p-0"
                        />
                        <input
                          value={backgroundColor}
                          onChange={(event) => setBackgroundColor(event.target.value.toUpperCase())}
                          className="w-24 text-sm font-semibold text-slate-700 outline-none"
                        />
                      </div>
                    )}
                    <button
                      onClick={handleRunProcessing}
                      disabled={processingLoading || !processingSummary || processingSummary.pending === 0}
                      className="rounded-lg bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      {processingLoading ? "Processing..." : "Process 1 Foto"}
                    </button>
                  </div>
                </div>

                {processingSummary && (
                  <div className="mb-5 grid grid-cols-3 gap-3">
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-xs font-medium uppercase text-slate-400">Pending</div>
                      <div className="text-xl font-bold text-slate-600">{processingSummary.pending}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-xs font-medium uppercase text-slate-400">Ready</div>
                      <div className="text-xl font-bold text-emerald-600">{processingSummary.ready}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-xs font-medium uppercase text-slate-400">Failed</div>
                      <div className="text-xl font-bold text-red-600">{processingSummary.failed}</div>
                    </div>
                  </div>
                )}

                {processRunSummary && (
                  <div className="mb-5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
                    Batch terakhir: {processRunSummary.processed} ready, {processRunSummary.failed} gagal, {processRunSummary.skipped} dilewati.
                  </div>
                )}

                {processingSummary && processingSummary.ready > 0 && processingSummary.pending === 0 && processingSummary.failed === 0 && (
                  <div className="mb-5 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
                    <div>
                      <div className="text-sm font-semibold text-emerald-900">
                        Semua foto matched sudah selesai processing.
                      </div>
                      <div className="mt-1 text-xs text-emerald-700">
                        Buat dua folder output cetak: nama murid dan serial No Foto.
                      </div>
                    </div>
                    <button
                      onClick={handleRename}
                      disabled={renameLoading}
                      className="rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      {renameLoading ? "Membuat Output..." : "Buat Output Cetak"}
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
                  {processingItems.map((item) => (
                    <div key={item.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                      <div className="relative flex aspect-[4/3] items-center justify-center bg-slate-100">
                        {item.processing_status === "READY" ? (
                          <img
                            src={`${API_URL}/api/sessions/${session.id}/processing-items/${item.id}/image`}
                            alt={item.student_name}
                            className="max-h-full max-w-full object-contain"
                            loading="lazy"
                          />
                        ) : (
                          <div className="px-4 text-center text-sm text-slate-400">
                            {item.processing_status === "FAILED" ? "Processing gagal" : "Belum diproses"}
                          </div>
                        )}
                        <span
                          className={`absolute right-2 top-2 rounded-full px-2 py-1 text-[10px] font-bold ${
                            item.processing_status === "READY"
                              ? "bg-emerald-600 text-white"
                              : item.processing_status === "FAILED"
                                ? "bg-red-600 text-white"
                                : "bg-white text-slate-700 ring-1 ring-slate-200"
                          }`}
                        >
                          {item.processing_status}
                        </span>
                      </div>
                      <div className="space-y-2 p-3">
                        <div className="truncate text-sm font-semibold text-slate-950">
                          {item.student_name}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {item.photo_number || "-"} - {item.class_name || "-"}
                        </div>
                        <div className="truncate rounded-md bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">
                          {item.processing_path || item.final_filename || "-"}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500">
                          <span
                            className="h-4 w-4 rounded border border-slate-200"
                            style={{
                              backgroundColor:
                                item.processing_background === "NO_FILL"
                                  ? "transparent"
                                  : item.processing_background || backgroundColor,
                            }}
                          />
                          <span>
                            {item.processing_background === "NO_FILL"
                              ? "No Fill"
                              : item.processing_background || (backgroundMode === "NO_FILL" ? "No Fill" : backgroundColor)}
                          </span>
                        </div>
                        {item.processing_notes && (
                          <div className="text-[11px] text-red-600">
                            {item.processing_notes}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => handleResetProcessingItem(item.id)}
                          disabled={processingResetId === item.id}
                          className="mt-2 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          {processingResetId === item.id ? "Reset..." : "Reset"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-6">
              <button
                type="button"
                onClick={goPreviousStep}
                disabled={!hasPreviousStep}
                className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              >
                Back
              </button>

              <div className="min-w-0 px-4 text-center text-xs text-slate-500">
                {session ? (
                  <span className="block truncate">
                    {session.session_code} - {session.school_name} - {session.status}
                  </span>
                ) : (
                  <span>Belum ada session aktif</span>
                )}
              </div>

              <button
                type="button"
                onClick={goNextStep}
                disabled={!hasNextStep}
                className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
              >
                Next
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
