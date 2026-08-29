'use client';

import type { IdentityDocumentKind, IdentityDocumentRecord, IdentityDocumentSide, IdentityProfilePayload, IdentityProfilePhotoCategory, IdentityProfilePhotoRecord, PasswordServiceOption, ServiceCredentialRecord, VerificationCodeCandidate } from '@/lib/identity-types';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { ThemeToggle } from '@/app/theme-toggle';
import { generateServicePassword, getServicePasswordPolicy, isServicePasswordCompatible } from '@/lib/service-password-generation';
import { getServiceRegistrationReadiness, registrationRequirementLabels, serviceRegistrationRequirements } from '@/lib/service-registration-requirements';
import { useGuardedFetch } from '@/lib/use-guarded-fetch';
import { unicodeLength } from '@/lib/unicode-text';

type Notice = { tone: 'success' | 'error' | 'info'; text: string } | null;

const documentKindLabels: Record<IdentityDocumentKind, string> = {
  drivers_license: '運転免許証',
  passport: 'パスポート',
  my_number_card: 'マイナンバーカード',
  residence_card: '在留カード',
  health_insurance: '健康保険証',
  other: 'その他の公的書類',
};

const documentSideLabels: Record<IdentityDocumentSide, string> = {
  single: '1ページ',
  front: '表面',
  back: '裏面',
};

const documentKindOptions = Object.entries(documentKindLabels);
const documentSideOptions = Object.entries(documentSideLabels);

const initialDocumentForm = {
  kind: 'drivers_license' as IdentityDocumentKind,
  side: 'front' as IdentityDocumentSide,
  expiresOn: '',
  consent: false,
};

const initialCredentialForm = {
  serviceKey: '',
  customServiceLabel: '',
  loginId: '',
  password: '',
  passwordConfirmation: '',
  registrationFillEnabled: false,
};

const photoCategoryLabels: Record<IdentityProfilePhotoCategory, string> = {
  face: '顔が分かる写真',
  full_body: '全身写真',
  hobby: '趣味・活動',
  travel: '旅行・お出かけ',
  food: '食事・料理',
  pet: 'ペット',
  other: 'その他',
};

const initialPhotoForm = {
  category: 'face' as IdentityProfilePhotoCategory,
  caption: '',
  makePrimary: false,
  consent: false,
};

const registrationFitLabels = { priority: '優先', standard: '標準', conditional: '条件付き' } as const;
const registrationOperationLabels = { assisted: '入力補助', manual: '本人操作', official_ai: '公式AI' } as const;

export default function IdentityClient({ initialData, gmailResult, passwordServices }: { initialData: IdentityProfilePayload; gmailResult: string; passwordServices: PasswordServiceOption[] }) {
  const fetchWithTimeout = useGuardedFetch();
  const [data, setData] = useState(initialData);
  const [form, setForm] = useState(initialData.profile);
  const [notice, setNotice] = useState<Notice>(() => gmailResultNotice(gmailResult));
  const [isSaving, setIsSaving] = useState(false);
  const [gmailAction, setGmailAction] = useState<'connect' | 'disconnect' | 'codes' | null>(null);
  const [serviceHint, setServiceHint] = useState('');
  const [codes, setCodes] = useState<VerificationCodeCandidate[]>([]);
  const [documents, setDocuments] = useState(initialData.documents);
  const [documentForm, setDocumentForm] = useState(initialDocumentForm);
  const [selectedDocument, setSelectedDocument] = useState<File | null>(null);
  const [documentAction, setDocumentAction] = useState<'upload' | string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [credentials, setCredentials] = useState(initialData.credentials);
  const [credentialForm, setCredentialForm] = useState(initialCredentialForm);
  const [credentialAction, setCredentialAction] = useState<'save' | 'reveal' | string | null>(null);
  const [pendingCredentialDeleteId, setPendingCredentialDeleteId] = useState<string | null>(null);
  const [revealCredentialId, setRevealCredentialId] = useState<string | null>(null);
  const [accountPassword, setAccountPassword] = useState('');
  const [revealedCredential, setRevealedCredential] = useState<{ id: string; loginId: string; password: string } | null>(null);
  const [showCredentialPassword, setShowCredentialPassword] = useState(false);
  const [photos, setPhotos] = useState(initialData.photos);
  const [photoForm, setPhotoForm] = useState(initialPhotoForm);
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [photoAction, setPhotoAction] = useState<'upload' | string | null>(null);
  const [pendingPhotoDeleteId, setPendingPhotoDeleteId] = useState<string | null>(null);
  const [photoInputKey, setPhotoInputKey] = useState(0);

  const hasFacePhoto = photos.some((photo) => photo.category === 'face');
  const profileFields = [form.registrationEmail, form.legalName, form.nickname, form.birthDate, form.residence, form.bio, form.relationshipGoal, form.interests, hasFacePhoto ? 'face' : ''];
  const completion = Math.round((profileFields.filter(Boolean).length / profileFields.length) * 100);
  const serviceReadiness = serviceRegistrationRequirements.map((service) => ({
    service,
    readiness: getServiceRegistrationReadiness(service, {
      ...form,
      hasFacePhoto,
      hasIdentityDocument: documents.length > 0,
      credentialServiceKeys: new Set(credentials.map((credential) => credential.serviceKey)),
    }),
  }));
  const completeServiceCount = serviceReadiness.filter(({ readiness }) => readiness.complete).length;

  const update = <Key extends keyof typeof form>(key: Key, value: (typeof form)[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setNotice(null);
    try {
      const response = await fetchWithTimeout('/api/identity', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const result = await response.json() as { profile?: IdentityProfilePayload; error?: string };
      if (!response.ok || !result.profile) throw new Error(result.error ?? 'save_failed');
      setData(result.profile);
      setForm(result.profile.profile);
      setPhotos(result.profile.photos);
      setNotice({ tone: 'success', text: '登録情報を暗号化して保存しました。次回の新規登録準備から使用できます。' });
    } catch (error) {
      setNotice({ tone: 'error', text: identityErrorMessage(error) });
    } finally {
      setIsSaving(false);
    }
  };

  const connectGmail = async () => {
    setGmailAction('connect');
    setNotice(null);
    try {
      const response = await fetchWithTimeout('/api/integrations/gmail/connect', { method: 'POST' });
      const result = await response.json() as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error ?? 'gmail_connect_failed');
      window.location.assign(result.url);
    } catch (error) {
      setNotice({ tone: 'error', text: identityErrorMessage(error) });
      setGmailAction(null);
    }
  };

  const disconnectGmail = async () => {
    setGmailAction('disconnect');
    setNotice(null);
    try {
      const response = await fetchWithTimeout('/api/integrations/gmail/disconnect', { method: 'POST' });
      if (!response.ok) throw new Error('gmail_disconnect_failed');
      setData((current) => ({ ...current, gmail: { ...current.gmail, connected: false, email: '', status: 'not_connected', lastSyncedAt: null } }));
      setForm((current) => ({ ...current, gmailCodeAssistEnabled: false }));
      setCodes([]);
      setNotice({ tone: 'success', text: 'Gmail連携と保存したGoogleトークンを削除しました。' });
    } catch {
      setNotice({ tone: 'error', text: 'Gmail連携を解除できませんでした。時間をおいて再試行してください。' });
    } finally {
      setGmailAction(null);
    }
  };

  const findCodes = async () => {
    setGmailAction('codes');
    setNotice(null);
    setCodes([]);
    try {
      const response = await fetchWithTimeout('/api/integrations/gmail/codes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ serviceHint, maxAgeMinutes: 15 }),
      });
      const result = await response.json() as { codes?: VerificationCodeCandidate[]; error?: string };
      if (!response.ok || !result.codes) throw new Error(result.error ?? 'gmail_codes_failed');
      setCodes(result.codes);
      setNotice(result.codes.length
        ? { tone: 'success', text: `${result.codes.length}件の認証コード候補を見つけました。メール本文は保存していません。` }
        : { tone: 'info', text: '直近15分の認証メールにコード候補はありませんでした。サービス名を空欄にして再試行できます。' });
    } catch (error) {
      setNotice({ tone: 'error', text: identityErrorMessage(error) });
    } finally {
      setGmailAction(null);
    }
  };

  const copyValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice({ tone: 'success', text: `${label}をコピーしました。` });
    } catch {
      setNotice({ tone: 'info', text: `${label}: ${value}` });
    }
  };

  const uploadIdentityDocument = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedDocument || !documentForm.consent) return;
    setDocumentAction('upload');
    setNotice(null);
    const body = new FormData();
    body.set('file', selectedDocument);
    body.set('kind', documentForm.kind);
    body.set('side', documentForm.side);
    body.set('expiresOn', documentForm.expiresOn);
    body.set('consent', 'true');
    try {
      const response = await fetchWithTimeout('/api/identity/documents', { method: 'POST', body });
      const result = await response.json() as { document?: IdentityDocumentRecord; error?: string };
      if (!response.ok || !result.document) throw new Error(result.error ?? 'identity_document_save_failed');
      setDocuments((current) => [result.document!, ...current]);
      setSelectedDocument(null);
      setDocumentForm(initialDocumentForm);
      setFileInputKey((current) => current + 1);
      setNotice({ tone: 'success', text: '本人確認書類を暗号化して保存しました。外部サービスへは自動送信しません。' });
    } catch (error) {
      setNotice({ tone: 'error', text: identityErrorMessage(error) });
    } finally {
      setDocumentAction(null);
    }
  };

  const deleteIdentityDocument = async (documentId: string) => {
    setDocumentAction(documentId);
    setNotice(null);
    try {
      const response = await fetchWithTimeout(`/api/identity/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'identity_document_delete_failed');
      setDocuments((current) => current.filter((document) => document.id !== documentId));
      setPendingDeleteId(null);
      setNotice({ tone: 'success', text: '本人確認書類を保管庫から完全に削除しました。' });
    } catch (error) {
      setNotice({ tone: 'error', text: identityErrorMessage(error) });
    } finally {
      setDocumentAction(null);
    }
  };

  const uploadProfilePhoto = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedPhoto || !photoForm.consent) return;
    setPhotoAction('upload');
    setNotice(null);
    const body = new FormData();
    body.set('file', selectedPhoto);
    body.set('category', photoForm.category);
    body.set('caption', photoForm.caption);
    body.set('makePrimary', photoForm.makePrimary ? 'true' : 'false');
    body.set('consent', 'true');
    try {
      const response = await fetchWithTimeout('/api/identity/photos', { method: 'POST', body });
      const result = await response.json() as { photos?: IdentityProfilePhotoRecord[]; error?: string };
      if (!response.ok || !result.photos) throw new Error(result.error ?? 'profile_photo_save_failed');
      setPhotos(result.photos);
      setSelectedPhoto(null);
      setPhotoForm(initialPhotoForm);
      setPhotoInputKey((current) => current + 1);
      setNotice({ tone: 'success', text: '共通プロフィール写真を暗号化して保存しました。主写真は登録準備で再利用できます。' });
    } catch (error) {
      setNotice({ tone: 'error', text: identityErrorMessage(error) });
    } finally {
      setPhotoAction(null);
    }
  };

  const updateProfilePhoto = async (photoId: string, action: 'set_primary' | 'move_left' | 'move_right') => {
    setPhotoAction(photoId);
    setNotice(null);
    try {
      const response = await fetchWithTimeout(`/api/identity/photos/${encodeURIComponent(photoId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const result = await response.json() as { photos?: IdentityProfilePhotoRecord[]; error?: string };
      if (!response.ok || !result.photos) throw new Error(result.error ?? 'profile_photo_update_failed');
      setPhotos(result.photos);
      setNotice({ tone: 'success', text: action === 'set_primary' ? '主写真を変更しました。' : '写真の表示順を変更しました。' });
    } catch (error) {
      setNotice({ tone: 'error', text: identityErrorMessage(error) });
    } finally {
      setPhotoAction(null);
    }
  };

  const deleteProfilePhoto = async (photoId: string) => {
    setPhotoAction(photoId);
    setNotice(null);
    try {
      const response = await fetchWithTimeout(`/api/identity/photos/${encodeURIComponent(photoId)}`, { method: 'DELETE' });
      const result = await response.json() as { photos?: IdentityProfilePhotoRecord[]; error?: string };
      if (!response.ok || !result.photos) throw new Error(result.error ?? 'profile_photo_delete_failed');
      setPhotos(result.photos);
      setPendingPhotoDeleteId(null);
      setNotice({ tone: 'success', text: 'プロフィール写真を保管庫から完全に削除しました。' });
    } catch (error) {
      setNotice({ tone: 'error', text: identityErrorMessage(error) });
    } finally {
      setPhotoAction(null);
    }
  };

  const selectedPasswordService = passwordServices.find((service) => service.id === credentialForm.serviceKey);
  const selectedPasswordPolicy = getServicePasswordPolicy(credentialForm.serviceKey);
  const credentialPasswordValid = isServicePasswordCompatible(credentialForm.serviceKey, credentialForm.password);

  const saveCredential = async (event: React.FormEvent) => {
    event.preventDefault();
    if (credentialForm.password !== credentialForm.passwordConfirmation) {
      setNotice({ tone: 'error', text: '確認用パスワードが一致しません。' });
      return;
    }
    setCredentialAction('save');
    setNotice(null);
    try {
      const response = await fetchWithTimeout('/api/identity/passwords', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(credentialForm),
      });
      const result = await response.json() as { credential?: ServiceCredentialRecord; registrationFillAvailable?: boolean; error?: string };
      if (!response.ok || !result.credential) throw new Error(result.error ?? 'service_credential_save_failed');
      setCredentials((current) => [result.credential!, ...current.filter((credential) => credential.id !== result.credential!.id)]);
      setCredentialForm(initialCredentialForm);
      setShowCredentialPassword(false);
      setNotice({
        tone: 'success',
        text: result.registrationFillAvailable
          ? 'サービス用パスワードを暗号化して保存しました。許可した場合だけ登録画面へ補助入力します。'
          : 'サービス用パスワードを暗号化して保存しました。このサービスは保管・コピーのみ対応です。',
      });
    } catch (error) {
      setNotice({ tone: 'error', text: identityErrorMessage(error) });
    } finally {
      setCredentialAction(null);
    }
  };

  const generateCredentialPassword = () => {
    const password = generateServicePassword(credentialForm.serviceKey);
    setCredentialForm((current) => ({ ...current, password, passwordConfirmation: password }));
    setShowCredentialPassword(true);
    setNotice({ tone: 'info', text: `${selectedPasswordPolicy.description}のサービス適合パスワードを端末内で生成しました。保存するまでサーバーへ送信しません。` });
  };

  const bulkGenerateCredentials = async () => {
    if (credentialAction !== null) return;
    setCredentialAction('bulk');
    setNotice(null);
    try {
      const response = await fetchWithTimeout('/api/identity/passwords/bulk-generate', { method: 'POST' });
      const result = await response.json() as { credentials?: ServiceCredentialRecord[]; created?: number; error?: string };
      if (!response.ok || !result.credentials) throw new Error(result.error ?? 'service_credential_bulk_failed');
      setCredentials(result.credentials);
      setNotice({
        tone: 'success',
        text: result.created
          ? `${result.created}サービス分の異なる強力なパスワードを生成し、暗号化保存しました。既存の保存値は変更していません。`
          : '登録補助対象のパスワードはすべて準備済みです。',
      });
    } catch (error) {
      setNotice({ tone: 'error', text: identityErrorMessage(error) });
    } finally {
      setCredentialAction(null);
    }
  };

  const revealServiceCredential = async (credentialId: string) => {
    if (!accountPassword) return;
    setCredentialAction('reveal');
    setNotice(null);
    try {
      const response = await fetchWithTimeout(`/api/identity/passwords/${encodeURIComponent(credentialId)}/reveal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountPassword }),
      });
      const result = await response.json() as { loginId?: string; password?: string; error?: string };
      if (!response.ok || typeof result.password !== 'string') throw new Error(result.error ?? 'service_credential_reveal_failed');
      setAccountPassword('');
      setRevealedCredential({ id: credentialId, loginId: result.loginId ?? '', password: result.password });
      setNotice({ tone: 'success', text: '本人確認が完了しました。30秒後にパスワードを自動で隠します。' });
      window.setTimeout(() => setRevealedCredential((current) => current?.id === credentialId ? null : current), 30_000);
    } catch (error) {
      setNotice({ tone: 'error', text: identityErrorMessage(error) });
    } finally {
      setCredentialAction(null);
    }
  };

  const deleteServiceCredential = async (credentialId: string) => {
    setCredentialAction(credentialId);
    setNotice(null);
    try {
      const response = await fetchWithTimeout(`/api/identity/passwords/${encodeURIComponent(credentialId)}`, { method: 'DELETE' });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'service_credential_delete_failed');
      setCredentials((current) => current.filter((credential) => credential.id !== credentialId));
      setPendingCredentialDeleteId(null);
      setRevealedCredential((current) => current?.id === credentialId ? null : current);
      setNotice({ tone: 'success', text: 'サービス用パスワードを完全に削除しました。' });
    } catch (error) {
      setNotice({ tone: 'error', text: identityErrorMessage(error) });
    } finally {
      setCredentialAction(null);
    }
  };

  return (
    <main className="identity-page">
      <header className="identity-topbar">
        <Link href="/?view=settings" className="identity-back" aria-label="設定に戻る">‹</Link>
        <div><span className="identity-brand-mark">M</span><strong>登録情報ハブ</strong></div>
        <div className="identity-top-actions"><ThemeToggle /><span className="identity-private-badge">本人専用</span></div>
      </header>

      <div className="identity-layout">
        <section className="identity-hero">
          <div><p className="eyebrow">REGISTRATION PROFILE</p><h1>一度入力して、<br />登録作業を短く。</h1><p>メール・電話番号・共通プロフィールを、各サービスの新規登録準備に再利用します。</p></div>
          <div className="identity-progress" aria-label={`プロフィール完成度${completion}%`}><span style={{ '--progress': `${completion * 3.6}deg` } as React.CSSProperties}><b>{completion}</b><small>%</small></span><p><strong>準備度</strong><small>{completion === 100 ? '登録準備が整っています' : '必要な項目だけ追加できます'}</small></p></div>
        </section>

        {notice && <div className={`identity-notice is-${notice.tone}`} role="status"><span aria-hidden="true">{notice.tone === 'success' ? '✓' : notice.tone === 'error' ? '!' : 'i'}</span><p>{notice.text}</p><button type="button" aria-label="通知を閉じる" onClick={() => setNotice(null)}>×</button></div>}
        {!data.vaultConfigured && <div className="identity-notice is-error" role="alert"><span aria-hidden="true">!</span><p>暗号化キーの設定が完了していないため、現在は保存できません。</p></div>}

        <section className="identity-card profile-photo-vault" aria-labelledby="profile-photo-title">
          <div className="identity-card-heading"><div><span className="identity-step">01</span><h2 id="profile-photo-title">共通プロフィール写真</h2><p>各サービスへ再利用する公開用の写真セット</p></div><span className="identity-encrypted">画像も暗号化</span></div>
          <div className="profile-photo-summary">
            <span><strong>{photos.length}<small>/{data.photoLimits.maximumCount}</small></strong><em>保存済み</em></span>
            <span className={photos.some((photo) => photo.isPrimary) ? 'is-ready' : ''}><strong>{photos.some((photo) => photo.isPrimary) ? '設定済み' : '未設定'}</strong><em>主写真</em></span>
            <p><b>主写真</b>は新規登録画面のプロフィール画像欄へ自動で準備します。本人確認書類とは分離され、学習には使いません。</p>
          </div>
          <div className="profile-photo-vault-grid">
            <form className="profile-photo-upload" onSubmit={uploadProfilePhoto}>
              <label className="profile-photo-drop">
                <input key={photoInputKey} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" required onChange={(event) => setSelectedPhoto(event.target.files?.[0] ?? null)} />
                <span aria-hidden="true">＋</span>
                <strong>{selectedPhoto ? selectedPhoto.name : 'プロフィール写真を追加'}</strong>
                <small>{selectedPhoto ? formatFileSize(selectedPhoto.size) : 'JPEG・PNG・WebP／1枚8MBまで'}</small>
              </label>
              <div className="profile-photo-form-grid">
                <label className="identity-field"><span>写真の用途</span><select value={photoForm.category} onChange={(event) => setPhotoForm((current) => ({ ...current, category: event.target.value as IdentityProfilePhotoCategory }))}>{Object.entries(photoCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="identity-field"><span>説明（任意）</span><input type="text" maxLength={120} value={photoForm.caption} onChange={(event) => setPhotoForm((current) => ({ ...current, caption: event.target.value }))} placeholder="カフェ巡りが好きです" /></label>
              </div>
              <label className={`identity-consent compact ${photos.length === 0 ? 'is-disabled' : ''}`}><input type="checkbox" disabled={photos.length === 0} checked={photoForm.makePrimary} onChange={(event) => setPhotoForm((current) => ({ ...current, makePrimary: event.target.checked }))} /><span><strong>この写真を主写真にする</strong><small>{photos.length === 0 ? '最初の1枚は自動で主写真になります' : '現在の主写真から安全に切り替えます'}</small></span></label>
              <label className="identity-consent compact"><input type="checkbox" checked={photoForm.consent} onChange={(event) => setPhotoForm((current) => ({ ...current, consent: event.target.checked }))} /><span><strong>公開プロフィール用として保存する</strong><small>登録補助をONにした公式画面だけで再利用します。</small></span></label>
              <button className="document-upload-button" type="submit" disabled={!selectedPhoto || !photoForm.consent || photoAction !== null || photos.length >= data.photoLimits.maximumCount}>{photoAction === 'upload' ? '暗号化して保存中…' : photos.length >= data.photoLimits.maximumCount ? '6枚保存済みです' : '写真を暗号化保存'}</button>
            </form>

            <div className="profile-photo-gallery-panel">
              <div className="document-list-heading"><strong>保存済み写真</strong><small>左から順に登録候補として管理</small></div>
              {photos.length === 0 ? <div className="profile-photo-empty"><span aria-hidden="true">◎</span><strong>まず主写真を1枚</strong><small>顔が自然に分かる明るい写真がおすすめです。</small></div> : <ol className="profile-photo-gallery">
                {photos.map((photo, index) => <li key={photo.id} className={photo.isPrimary ? 'is-primary' : ''}>
                  <div className="profile-photo-image"><Image unoptimized fill sizes="(max-width: 640px) 44vw, 180px" src={photo.previewUrl} alt={photo.caption || photoCategoryLabels[photo.category]} /></div>
                  <div className="profile-photo-meta"><strong>{photo.isPrimary ? '主写真' : photoCategoryLabels[photo.category]}</strong><small>{photo.caption || photoCategoryLabels[photo.category]} · {formatFileSize(photo.sizeBytes)}</small></div>
                  <div className="profile-photo-actions">
                    {!photo.isPrimary && <button type="button" disabled={photoAction !== null} onClick={() => void updateProfilePhoto(photo.id, 'set_primary')}>主写真にする</button>}
                    <button type="button" aria-label={`${index + 1}番目の写真を左へ移動`} disabled={index === 0 || photoAction !== null} onClick={() => void updateProfilePhoto(photo.id, 'move_left')}>←</button>
                    <button type="button" aria-label={`${index + 1}番目の写真を右へ移動`} disabled={index === photos.length - 1 || photoAction !== null} onClick={() => void updateProfilePhoto(photo.id, 'move_right')}>→</button>
                    {pendingPhotoDeleteId === photo.id ? <span><button type="button" disabled={photoAction !== null} onClick={() => void deleteProfilePhoto(photo.id)}>{photoAction === photo.id ? '削除中…' : '削除する'}</button><button type="button" onClick={() => setPendingPhotoDeleteId(null)}>やめる</button></span> : <button className="is-danger" type="button" disabled={photoAction !== null} onClick={() => setPendingPhotoDeleteId(photo.id)}>削除</button>}
                  </div>
                </li>)}
              </ol>}
            </div>
          </div>
        </section>

        <div className="identity-grid">
          <form className="identity-card identity-form-card" onSubmit={save}>
            <div className="identity-card-heading"><div><span className="identity-step">02</span><h2>共通プロフィール</h2><p>サービスごとに繰り返し入力する項目</p></div><span className="identity-encrypted">暗号化保存</span></div>

            <div className="identity-field-grid">
              <label className="identity-field is-wide"><span>登録用メールアドレス <b>必須</b></span><input type="email" inputMode="email" autoComplete="email" maxLength={254} required value={form.registrationEmail} onChange={(event) => update('registrationEmail', event.target.value)} placeholder="name@gmail.com" /></label>
              <label className="identity-field"><span>電話番号</span><input type="tel" inputMode="tel" autoComplete="tel" maxLength={30} value={form.phoneNumber} onChange={(event) => update('phoneNumber', event.target.value)} placeholder="09012345678" /><small>日本の番号は自動で+81形式に整えます</small></label>
              <label className="identity-field"><span>氏名（本人確認用）</span><input type="text" autoComplete="name" maxLength={80} value={form.legalName} onChange={(event) => update('legalName', event.target.value)} placeholder="公的書類と同じ氏名" /><small>暗号化保存し、外部ワーカーへ渡しません</small></label>
              <label className="identity-field"><span>氏名フリガナ</span><input type="text" autoComplete="off" maxLength={80} value={form.nameKana} onChange={(event) => update('nameKana', event.target.value)} placeholder="例：ヤマダ ハナコ" /><small>読み方は推測せず、ご本人の回答を保存します</small></label>
              <label className="identity-field"><span>ニックネーム <b>必須</b></span><input type="text" autoComplete="nickname" maxLength={40} required value={form.nickname} onChange={(event) => update('nickname', event.target.value)} placeholder="表示名" /></label>
              <label className="identity-field"><span>生年月日</span><input type="date" autoComplete="bday" value={form.birthDate} onInput={(event) => update('birthDate', event.currentTarget.value)} onChange={(event) => update('birthDate', event.target.value)} /></label>
              <label className="identity-field"><span>性別</span><select value={form.gender} onChange={(event) => update('gender', event.target.value)}><option value="">選択しない</option><option value="male">男性</option><option value="female">女性</option><option value="non_binary">ノンバイナリー</option><option value="other">その他</option><option value="prefer_not_to_say">回答しない</option></select></label>
              <label className="identity-field"><span>居住地</span><input type="text" autoComplete="address-level1" maxLength={60} value={form.residence} onChange={(event) => update('residence', event.target.value)} placeholder="東京都" /></label>
              <label className="identity-field"><span>職業</span><input type="text" autoComplete="organization-title" maxLength={80} value={form.occupation} onChange={(event) => update('occupation', event.target.value)} placeholder="会社員" /></label>
              <label className="identity-field is-wide"><span>共通の自己紹介</span><textarea maxLength={1000} value={form.bio} onChange={(event) => update('bio', event.target.value)} placeholder="休日の過ごし方、趣味、大切にしていることなど" /><small>{unicodeLength(form.bio)} / 1000</small></label>
            </div>

            <details className="identity-optional-profile">
              <summary><span><strong>よく聞かれる追加項目</strong><small>身長・体型・学歴・生活習慣・目的・趣味を一度だけ入力</small></span><b aria-hidden="true">＋</b></summary>
              <div className="identity-field-grid">
                <label className="identity-field"><span>身長</span><div className="identity-unit-input"><input type="number" inputMode="numeric" min={120} max={230} value={form.heightCm} onChange={(event) => update('heightCm', event.target.value)} placeholder="170" /><em>cm</em></div></label>
                <label className="identity-field"><span>体型</span><select value={form.bodyType} onChange={(event) => update('bodyType', event.target.value)}><option value="">選択しない</option><option value="slim">スリム</option><option value="average">普通</option><option value="athletic">筋肉質・スポーツ体型</option><option value="curvy">グラマー</option><option value="large">大柄</option><option value="prefer_not_to_say">回答しない</option></select></label>
                <label className="identity-field"><span>出身地</span><input type="text" maxLength={60} value={form.hometown} onChange={(event) => update('hometown', event.target.value)} placeholder="大阪府" /></label>
                <label className="identity-field"><span>学歴</span><select value={form.education} onChange={(event) => update('education', event.target.value)}><option value="">選択しない</option><option value="high_school">高校卒</option><option value="vocational">専門学校卒</option><option value="junior_college">短大・高専卒</option><option value="university">大学卒</option><option value="graduate_school">大学院卒</option><option value="other">その他</option><option value="prefer_not_to_say">回答しない</option></select></label>
                <label className="identity-field"><span>年収</span><select value={form.annualIncome} onChange={(event) => update('annualIncome', event.target.value)}><option value="">選択しない</option><option value="under_2m">200万円未満</option><option value="2m_4m">200〜400万円</option><option value="4m_6m">400〜600万円</option><option value="6m_8m">600〜800万円</option><option value="8m_10m">800〜1,000万円</option><option value="10m_15m">1,000〜1,500万円</option><option value="over_15m">1,500万円以上</option><option value="prefer_not_to_say">回答しない</option></select></label>
                <label className="identity-field"><span>婚姻歴</span><select value={form.maritalHistory} onChange={(event) => update('maritalHistory', event.target.value)}><option value="">選択しない</option><option value="never_married">未婚</option><option value="divorced">離婚</option><option value="widowed">死別</option><option value="prefer_not_to_say">回答しない</option></select></label>
                <label className="identity-field"><span>子ども</span><select value={form.children} onChange={(event) => update('children', event.target.value)}><option value="">選択しない</option><option value="none">いない</option><option value="has_children_living_together">同居している</option><option value="has_children_living_apart">別居している</option><option value="prefer_not_to_say">回答しない</option></select></label>
                <label className="identity-field"><span>喫煙</span><select value={form.smoking} onChange={(event) => update('smoking', event.target.value)}><option value="">選択しない</option><option value="never">吸わない</option><option value="occasionally">ときどき</option><option value="regularly">吸う</option><option value="trying_to_quit">禁煙中</option><option value="prefer_not_to_say">回答しない</option></select></label>
                <label className="identity-field"><span>お酒</span><select value={form.alcohol} onChange={(event) => update('alcohol', event.target.value)}><option value="">選択しない</option><option value="never">飲まない</option><option value="occasionally">ときどき</option><option value="socially">付き合い程度</option><option value="regularly">よく飲む</option><option value="prefer_not_to_say">回答しない</option></select></label>
                <label className="identity-field"><span>勤務・休日</span><input type="text" maxLength={80} value={form.workSchedule} onChange={(event) => update('workSchedule', event.target.value)} placeholder="平日勤務・土日休み" /></label>
                <label className="identity-field"><span>話せる言語</span><input type="text" maxLength={120} value={form.languages} onChange={(event) => update('languages', event.target.value)} placeholder="日本語、英語" /></label>
                <label className="identity-field is-wide"><span>出会いの目的</span><select value={form.relationshipGoal} onChange={(event) => update('relationshipGoal', event.target.value)}><option value="">選択しない</option><option value="serious_relationship">真剣な交際</option><option value="marriage">結婚を見据えた出会い</option><option value="friendship_first">まずは友達から</option><option value="casual_dating">気軽なデート</option><option value="activity_partner">趣味仲間</option><option value="prefer_not_to_say">回答しない</option></select></label>
                <label className="identity-field is-wide"><span>趣味・興味</span><textarea maxLength={300} value={form.interests} onChange={(event) => update('interests', event.target.value)} placeholder="旅行、カフェ、映画、料理、ジムなど" /><small>{unicodeLength(form.interests)} / 300</small></label>
                <label className="identity-field is-wide"><span>性格・価値観</span><textarea maxLength={300} value={form.personality} onChange={(event) => update('personality', event.target.value)} placeholder="周りから言われる性格、大切にしている価値観" /><small>{unicodeLength(form.personality)} / 300</small></label>
                <label className="identity-field is-wide"><span>最初のデート希望</span><textarea maxLength={300} value={form.firstDatePreference} onChange={(event) => update('firstDatePreference', event.target.value)} placeholder="まずは昼間にカフェで1時間ほど話したいです" /><small>{unicodeLength(form.firstDatePreference)} / 300</small></label>
              </div>
              <p className="identity-public-safety-note"><b>公開情報だけ</b> 本名・住所・書類番号はここに入力せず、本人確認書類保管庫と分けて管理してください。</p>
            </details>

            <label className={`identity-consent ${form.phoneNumber ? '' : 'is-disabled'}`}><input type="checkbox" disabled={!form.phoneNumber} checked={form.phoneOwnershipConfirmed} onChange={(event) => update('phoneOwnershipConfirmed', event.target.checked)} /><span><strong>この電話番号は本人所有です</strong><small>SMS認証は本人端末で受け取り、サービスの公式画面で使用します。</small></span></label>
            <label className="identity-consent"><input type="checkbox" checked={form.registrationAssistEnabled} onChange={(event) => update('registrationAssistEnabled', event.target.checked)} /><span><strong>新規登録の入力準備に使用する</strong><small>保存項目を登録準備へ渡します。規約同意・CAPTCHA・本人確認の確定は自動化しません。</small></span></label>

            <div className="identity-savebar"><span>{form.updatedAt ? `最終保存 ${new Date(form.updatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}` : 'まだ保存されていません'}</span><button type="submit" disabled={isSaving || !data.vaultConfigured || !form.registrationEmail || !form.nickname}>{isSaving ? '保存中…' : '安全に保存'}</button></div>
          </form>

          <aside className="identity-side-stack">
            <section className="identity-card gmail-card">
              <div className="identity-card-heading"><div><span className="identity-step">04</span><h2>Gmail認証</h2><p>認証番号だけを見つける</p></div><span className={`identity-status ${data.gmail.connected ? 'is-connected' : ''}`}>{data.gmail.connected ? '接続済み' : '未接続'}</span></div>
              {data.gmail.connected ? <>
                <div className="gmail-account"><span>G</span><p><strong>{data.gmail.email}</strong><small>読み取り専用 · 本文は保存しません</small></p></div>
                <label className="identity-consent compact"><input type="checkbox" checked={form.gmailCodeAssistEnabled} onChange={(event) => update('gmailCodeAssistEnabled', event.target.checked)} /><span><strong>認証コード取得を許可</strong><small>保存後に有効になります</small></span></label>
                <label className="identity-field is-wide"><span>サービス名で絞り込み（任意）</span><input type="text" value={serviceHint} onChange={(event) => setServiceHint(event.target.value)} maxLength={80} placeholder="Pairs、with など" /></label>
                <button type="button" className="gmail-code-button" disabled={gmailAction !== null || !form.gmailCodeAssistEnabled} onClick={() => void findCodes()}>{gmailAction === 'codes' ? 'メールを確認中…' : '最新15分の認証コードを取得'}</button>
                {codes.length > 0 && <ol className="verification-code-list">{codes.map((candidate) => <li key={`${candidate.receivedAt}-${candidate.code}`}><button type="button" onClick={() => void copyValue(candidate.code, '認証コード')}><span><b>{candidate.code}</b><small>{candidate.subject || candidate.sender}</small></span><em>コピー</em></button></li>)}</ol>}
                <button type="button" className="identity-text-button danger" disabled={gmailAction !== null} onClick={() => void disconnectGmail()}>{gmailAction === 'disconnect' ? '解除中…' : 'Gmail連携を解除'}</button>
              </> : <>
                <div className="gmail-empty"><span>G</span><h3>本人のGmailを接続</h3><p>Googleの同意画面で読み取り専用アクセスを許可します。GmailのパスワードはMatchPilotへ渡りません。</p></div>
                <button type="button" className="gmail-connect-button" disabled={gmailAction !== null || !data.gmail.oauthConfigured} onClick={() => void connectGmail()}>{gmailAction === 'connect' ? 'Googleへ移動中…' : 'Gmailを安全に接続'}</button>
                {!data.gmail.oauthConfigured && <p className="identity-config-note">Google OAuth設定待ちです。設定後、このボタンから接続できます。</p>}
              </>}
            </section>

            <section className="identity-card security-card">
              <div className="identity-card-heading"><div><span className="identity-step">07</span><h2>自動送信しない情報</h2><p>事故を防ぐ安全境界</p></div></div>
              <ul><li><span>×</span><p><strong>パスワードの無断送信</strong><small>許可した登録画面への補助入力だけ</small></p></li><li><span>×</span><p><strong>本人確認書類の自動提出</strong><small>暗号化保管のみ。提出確定は本人操作</small></p></li><li><span>×</span><p><strong>認証メールの本文</strong><small>番号候補を一時表示するだけ</small></p></li></ul>
            </section>
          </aside>
        </div>

        <section className="identity-card registration-requirements-card" aria-labelledby="registration-requirements-title">
          <div className="identity-card-heading"><div><span className="identity-step">03</span><h2 id="registration-requirements-title">サービス別登録要件</h2><p>質問に答えると、対応サービスの不足項目が自動で埋まります</p></div><span className="identity-encrypted">回答も暗号化</span></div>
          <div className="registration-readiness-summary">
            <div><strong>{completeServiceCount}<small>/{serviceReadiness.length}</small></strong><span>登録要件が完成</span></div>
            <p><span aria-hidden="true">✓</span><span><strong>17サービスを一つの入力元で管理</strong><small>サービス固有の必須項目だけを表示し、規約同意・本人確認・課金確定は本人操作で止めます。</small></span></p>
          </div>

          <form className="registration-settings-panel" onSubmit={save}>
            <div className="document-list-heading"><strong>まず答えてほしい設定</strong><small>分からない項目は空欄のまま保存できます</small></div>
            <div className="registration-settings-grid">
              <label className="identity-field"><span>希望するログイン方法</span><select value={form.preferredLoginMethod} onChange={(event) => update('preferredLoginMethod', event.target.value)}><option value="">サービスごとに選ぶ</option><option value="email">メール</option><option value="phone">電話番号</option><option value="google">Google</option><option value="line">LINE</option><option value="apple">Apple</option></select></label>
              <label className="identity-field"><span>パスワードの作り方</span><select value={form.passwordStrategy} onChange={(event) => update('passwordStrategy', event.target.value)}><option value="">選択してください</option><option value="service_specific">サービスごとに異なる安全な値（推奨）</option><option value="common_when_compatible">仕様が合う場合だけ共通</option><option value="manual">自分で入力</option></select></label>
              <label className="identity-field"><span>東京都の対象条件</span><select value={form.tokyoEligibility} onChange={(event) => update('tokyoEligibility', event.target.value)}><option value="">未回答</option><option value="resident">都内在住</option><option value="worker">都内在勤</option><option value="student">都内在学</option><option value="not_eligible">該当しない</option></select></label>
              <label className="identity-field"><span>独身証明書</span><select value={form.singleCertificateStatus} onChange={(event) => update('singleCertificateStatus', event.target.value)}><option value="">未回答</option><option value="ready">用意済み</option><option value="requesting">取得中</option><option value="not_ready">未取得</option></select></label>
              <label className="identity-field"><span>収入証明書</span><select value={form.incomeProofStatus} onChange={(event) => update('incomeProofStatus', event.target.value)}><option value="">未回答</option><option value="ready">用意済み</option><option value="requesting">取得中</option><option value="not_ready">未取得</option></select></label>
              <label className="identity-consent compact registration-single-check"><input type="checkbox" checked={form.singleStatusConfirmed} onChange={(event) => update('singleStatusConfirmed', event.target.checked)} /><span><strong>現在独身で、交際相手はいません</strong><small>事実である場合だけご本人がチェックしてください</small></span></label>
              <label className="identity-field is-wide"><span>以前登録したことがあるサービス</span><textarea maxLength={1000} value={form.previouslyRegisteredServices} onChange={(event) => update('previouslyRegisteredServices', event.target.value)} placeholder="Pairs、with など。既存アカウントの重複作成を防ぐために使用します" /><small>サービス名だけを入力。パスワードや認証コードは書かないでください</small></label>
              <label className="identity-field is-wide"><span>既存アカウントの復旧メモ</span><textarea maxLength={500} value={form.accountRecoveryNotes} onChange={(event) => update('accountRecoveryNotes', event.target.value)} placeholder="登録に使ったメールや電話の種類、公式サポートへの問い合わせ状況など" /><small>秘密情報はパスワード保管庫に保存してください</small></label>
              <label className="identity-consent compact registration-single-check"><input type="checkbox" checked={form.singleAccountPolicyConfirmed} onChange={(event) => update('singleAccountPolicyConfirmed', event.target.checked)} /><span><strong>1サービス1アカウントで運用する</strong><small>既存登録がある場合は新規作成せず、公式のログイン・復旧を使います</small></span></label>
            </div>
            <div className="registration-settings-save"><span>回答は本人専用の暗号化プロフィールに保存されます</span><button type="submit" disabled={isSaving || !data.vaultConfigured || !form.registrationEmail || !form.nickname}>{isSaving ? '保存中…' : '要件設定を保存'}</button></div>
          </form>

          <details className="registration-service-list" open>
            <summary><span><strong>対応候補と不足項目</strong><small>各カードを見れば、次に必要な回答が分かります</small></span><b aria-hidden="true">＋</b></summary>
            <div className="registration-service-grid">
              {serviceReadiness.map(({ service, readiness }) => <article key={service.id} className={`registration-service-card ${readiness.complete ? 'is-complete' : ''}`}>
                <div className="registration-service-title"><span>{Array.from(service.label)[0]}</span><p><strong>{service.label}</strong><small>{service.loginMethods.join(' / ')}</small></p><em>{readiness.ready}/{readiness.total}</em></div>
                <div className="registration-service-badges"><span className={`fit-${service.fit}`}>{registrationFitLabels[service.fit]}</span><span>{registrationOperationLabels[service.operation]}</span>{readiness.complete && <span className="is-ready">準備完了</span>}</div>
                <div className="registration-progress-track"><span style={{ width: `${Math.round((readiness.ready / readiness.total) * 100)}%` }} /></div>
                {readiness.missing.length > 0 ? <ul className="registration-missing-list">{readiness.missing.slice(0, 4).map((key) => <li key={key}>{registrationRequirementLabels[key]}</li>)}{readiness.missing.length > 4 && <li>ほか {readiness.missing.length - 4}項目</li>}</ul> : <p className="registration-complete-copy">登録準備に必要な保存項目がそろっています。</p>}
                <p className="registration-service-note">{service.note}</p>
              </article>)}
            </div>
          </details>
        </section>

        <section className="identity-card credential-vault-card" aria-labelledby="credential-vault-title">
          <div className="identity-card-heading"><div><span className="identity-step">05</span><h2 id="credential-vault-title">サービス別パスワード保管庫</h2><p>全サービスを一つの暗号化保管庫で管理</p></div><span className="identity-encrypted">本人確認で表示</span></div>
          <div className="credential-vault-summary">
            <div><strong>{credentials.length}<small>/{data.credentialLimits.maximumCount}</small></strong><span>登録済み</span></div>
            <p><span aria-hidden="true">✓</span><span><strong>対応一覧にないサービスも保存できます</strong><small>「その他のサービス」を選び、サービス名を入力してください。</small></span></p>
            <Link href="/accounts/new">保存情報で一括登録準備へ <span aria-hidden="true">→</span></Link>
          </div>
          <div className="credential-bulk-provision">
            <span aria-hidden="true">⚿</span>
            <p><strong>不足分を一括で安全に準備</strong><small>共通メールをログインIDに使い、各サービスの仕様に合う異なるパスワードを作ります。既存値は上書きしません。</small></p>
            <button type="button" disabled={credentialAction !== null || !data.vaultConfigured || !data.profile.registrationEmail} onClick={() => void bulkGenerateCredentials()}>{credentialAction === 'bulk' ? '暗号化して準備中…' : '未登録サービス分を一括生成'}</button>
          </div>
          <div className="credential-vault-grid">
            <form className="credential-form-panel" onSubmit={saveCredential}>
              <div className="document-list-heading"><strong>パスワードを追加・更新</strong><small>同じサービスを保存すると安全に上書き</small></div>
              <label className="identity-field is-wide"><span>サービス</span><select required value={credentialForm.serviceKey} onChange={(event) => setCredentialForm((current) => ({ ...current, serviceKey: event.target.value, registrationFillEnabled: passwordServices.find((service) => service.id === event.target.value)?.registrationFillAvailable ? current.registrationFillEnabled : false }))}><option value="">選択してください</option>{passwordServices.map((service) => <option key={service.id} value={service.id}>{service.label}</option>)}<option value="custom">その他のサービス</option></select></label>
              {credentialForm.serviceKey === 'custom' && <label className="identity-field is-wide"><span>サービス名</span><input type="text" required maxLength={80} value={credentialForm.customServiceLabel} onChange={(event) => setCredentialForm((current) => ({ ...current, customServiceLabel: event.target.value }))} placeholder="サービス名を入力" /></label>}
              <label className="identity-field is-wide"><span>ログインID・メール（任意）</span><input type="text" autoComplete="username" maxLength={254} value={credentialForm.loginId} onChange={(event) => setCredentialForm((current) => ({ ...current, loginId: event.target.value }))} placeholder="メールアドレス、会員IDなど" /></label>
              <div className="credential-password-row">
                <label className="identity-field"><span>サービス用パスワード</span><input type={showCredentialPassword ? 'text' : 'password'} autoComplete="new-password" minLength={selectedPasswordPolicy.minimumLength} maxLength={selectedPasswordPolicy.maximumLength} required value={credentialForm.password} onChange={(event) => setCredentialForm((current) => ({ ...current, password: event.target.value }))} placeholder={selectedPasswordPolicy.description} /></label>
                <label className="identity-field"><span>確認</span><input type={showCredentialPassword ? 'text' : 'password'} autoComplete="new-password" minLength={selectedPasswordPolicy.minimumLength} maxLength={selectedPasswordPolicy.maximumLength} required value={credentialForm.passwordConfirmation} onChange={(event) => setCredentialForm((current) => ({ ...current, passwordConfirmation: event.target.value }))} placeholder="もう一度入力" /></label>
              </div>
              <p className="password-policy-note"><strong>{selectedPasswordPolicy.description}</strong> 選択したサービスの公開仕様に合わせて検証します。</p>
              <div className="credential-generator-actions"><button type="button" onClick={generateCredentialPassword}>仕様に合うパスワードを自動生成</button><button type="button" onClick={() => setShowCredentialPassword((current) => !current)}>{showCredentialPassword ? '隠す' : '入力を表示'}</button></div>
              <label className={`identity-consent compact ${selectedPasswordService?.registrationFillAvailable ? '' : 'is-disabled'}`}><input type="checkbox" disabled={!selectedPasswordService?.registrationFillAvailable} checked={credentialForm.registrationFillEnabled} onChange={(event) => setCredentialForm((current) => ({ ...current, registrationFillEnabled: event.target.checked }))} /><span><strong>新規登録画面への補助入力を許可</strong><small>{selectedPasswordService?.registrationFillAvailable ? '選択サービスの登録準備時だけ入力し、送信前に停止します。' : 'このサービスは現在、暗号化保管とコピーのみ対応です。'}</small></span></label>
              <button className="document-upload-button" type="submit" disabled={credentialAction !== null || !credentialForm.serviceKey || !credentialPasswordValid || credentialForm.password !== credentialForm.passwordConfirmation}>{credentialAction === 'save' ? '暗号化して保存中…' : 'パスワードを暗号化保存'}</button>
            </form>

            <div className="credential-list-panel">
              <div className="document-list-heading"><strong>保存済みパスワード</strong><small>通常は内容を画面へ返しません</small></div>
              {credentials.length === 0 ? <div className="document-empty"><span aria-hidden="true">⌁</span><strong>まだ保存されていません</strong><small>左のフォームから最初のサービスを追加できます。</small></div> : <ol className="credential-list">
                {credentials.map((credential) => <li key={credential.id}>
                  <span className="credential-service-mark" aria-hidden="true">{Array.from(credential.serviceLabel)[0]}</span>
                  <div className="credential-main"><strong>{credential.serviceLabel}</strong><small>{credential.loginHint} · 更新 {new Date(credential.passwordUpdatedAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}</small><em>{credential.registrationFillEnabled ? '登録補助ON' : '保管のみ'}</em>
                    {revealedCredential?.id === credential.id && <div className="credential-revealed"><span><b>ログインID</b><code>{revealedCredential.loginId || '未設定'}</code><button type="button" onClick={() => void copyValue(revealedCredential.loginId, 'ログインID')}>コピー</button></span><span><b>パスワード</b><code>{revealedCredential.password}</code><button type="button" onClick={() => void copyValue(revealedCredential.password, 'パスワード')}>コピー</button></span><button type="button" onClick={() => setRevealedCredential(null)}>すぐ隠す</button></div>}
                    {revealCredentialId === credential.id && revealedCredential?.id !== credential.id && <div className="credential-reauth"><label className="identity-field"><span>MatchPilotのパスワードで本人確認</span><input type="password" autoComplete="current-password" maxLength={128} value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} /></label><div><button type="button" disabled={!accountPassword || credentialAction !== null} onClick={() => void revealServiceCredential(credential.id)}>{credentialAction === 'reveal' ? '確認中…' : '確認して表示'}</button><button type="button" onClick={() => { setRevealCredentialId(null); setAccountPassword(''); }}>やめる</button></div></div>}
                  </div>
                  <div className="credential-actions">
                    <button type="button" aria-expanded={revealCredentialId === credential.id || revealedCredential?.id === credential.id} aria-label={`${credential.serviceLabel}のパスワードを表示`} onClick={() => { setRevealCredentialId((current) => current === credential.id ? null : credential.id); setAccountPassword(''); setRevealedCredential(null); }}>表示</button>
                    {pendingCredentialDeleteId === credential.id ? <span><button type="button" disabled={credentialAction !== null} onClick={() => void deleteServiceCredential(credential.id)}>{credentialAction === credential.id ? '削除中…' : '削除する'}</button><button type="button" onClick={() => setPendingCredentialDeleteId(null)}>やめる</button></span> : <button type="button" aria-label={`${credential.serviceLabel}の保存パスワードを削除`} onClick={() => setPendingCredentialDeleteId(credential.id)}>削除</button>}
                  </div>
                </li>)}
              </ol>}
            </div>
          </div>
        </section>

        <section className="identity-card document-vault-card" aria-labelledby="document-vault-title">
          <div className="identity-card-heading"><div><span className="identity-step">06</span><h2 id="document-vault-title">本人確認書類保管庫</h2><p>端末から暗号化して、安全に再利用</p></div><span className="identity-encrypted">AES-GCM暗号化</span></div>
          <div className="document-vault-summary">
            <p><strong>{documents.length}<small>/{data.documentLimits.maximumCount}</small></strong><span>保存済み</span></p>
            <p><strong>{formatFileSize(documents.reduce((total, document) => total + document.sizeBytes, 0))}</strong><span>使用容量</span></p>
            <div><span aria-hidden="true">✓</span><p><strong>本人だけが閲覧・削除できます</strong><small>ワーカーや外部サービスには渡しません。提出時は公式画面から本人が選択します。</small></p></div>
          </div>

          <div className="document-vault-grid">
            <form className="document-upload-panel" onSubmit={uploadIdentityDocument}>
              <label className="document-file-drop">
                <input key={fileInputKey} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf" required onChange={(event) => setSelectedDocument(event.target.files?.[0] ?? null)} />
                <span aria-hidden="true">＋</span>
                <strong>{selectedDocument ? selectedDocument.name : '写真またはPDFを選択'}</strong>
                <small>{selectedDocument ? formatFileSize(selectedDocument.size) : 'iPhone写真・JPEG・PNG・WebP・HEIC・PDF／最大12MB'}</small>
              </label>
              <div className="document-form-grid">
                <label className="identity-field"><span>書類の種類</span><select value={documentForm.kind} onChange={(event) => { const kind = event.target.value as IdentityDocumentKind; setDocumentForm((current) => ({ ...current, kind, side: kind === 'my_number_card' && current.side === 'back' ? 'front' : current.side })); }}>{documentKindOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="identity-field"><span>面・ページ</span><select value={documentForm.side} onChange={(event) => setDocumentForm((current) => ({ ...current, side: event.target.value as IdentityDocumentSide }))}>{documentSideOptions.map(([value, label]) => <option key={value} value={value} disabled={documentForm.kind === 'my_number_card' && value === 'back'}>{label}</option>)}</select>{documentForm.kind === 'my_number_card' && <small>個人番号が記載された裏面は保存できません</small>}</label>
                <label className="identity-field is-wide"><span>有効期限（任意）</span><input type="date" value={documentForm.expiresOn} onChange={(event) => setDocumentForm((current) => ({ ...current, expiresOn: event.target.value }))} /><small>期限切れは一覧で警告します</small></label>
              </div>
              <label className="identity-consent compact"><input type="checkbox" checked={documentForm.consent} onChange={(event) => setDocumentForm((current) => ({ ...current, consent: event.target.checked }))} /><span><strong>暗号化保管に同意する</strong><small>ファイルは暗号化して保存し、自動提出やAI学習には使用しません。</small></span></label>
              <button className="document-upload-button" type="submit" disabled={!selectedDocument || !documentForm.consent || documentAction !== null || documents.length >= data.documentLimits.maximumCount}>{documentAction === 'upload' ? '暗号化して保存中…' : documents.length >= data.documentLimits.maximumCount ? '保存上限に達しました' : '暗号化して保存'}</button>
            </form>

            <div className="document-list-panel">
              <div className="document-list-heading"><strong>保存済み書類</strong><small>ファイル名は保存しません</small></div>
              {documents.length === 0 ? <div className="document-empty"><span aria-hidden="true">▣</span><strong>まだ保存されていません</strong><small>最初の書類を左から追加できます。</small></div> : <ol className="identity-document-list">
                {documents.map((document) => <li key={document.id} className={document.expired ? 'is-expired' : ''}>
                  <span className="document-kind-icon" aria-hidden="true">▤</span>
                  <div><strong>{documentKindLabels[document.kind]} · {documentSideLabels[document.side]}</strong><small>{formatFileSize(document.sizeBytes)} · {new Date(document.createdAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}{document.expiresOn ? ` · 期限 ${document.expiresOn.replaceAll('-', '/')}` : ''}</small><em>{document.expired ? '期限切れ' : '暗号化済み'}</em></div>
                  <div className="document-actions">
                    <a href={document.downloadUrl}>ダウンロード</a>
                    {pendingDeleteId === document.id ? <span><button type="button" disabled={documentAction !== null} onClick={() => void deleteIdentityDocument(document.id)}>{documentAction === document.id ? '削除中…' : '削除する'}</button><button type="button" onClick={() => setPendingDeleteId(null)}>やめる</button></span> : <button type="button" onClick={() => setPendingDeleteId(document.id)}>削除</button>}
                  </div>
                </li>)}
              </ol>}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function gmailResultNotice(result: string): Notice {
  if (result === 'connected') return { tone: 'success', text: 'Gmailを接続しました。認証コード取得を有効にして保存してください。' };
  if (result === 'denied') return { tone: 'info', text: 'Gmail接続はキャンセルされました。' };
  if (result === 'expired') return { tone: 'error', text: 'Gmail接続の有効時間が切れました。もう一度接続してください。' };
  if (result === 'error') return { tone: 'error', text: 'Gmailを接続できませんでした。Google側の設定と許可を確認してください。' };
  return null;
}

function identityErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  const messages: Record<string, string> = {
    identity_vault_not_configured: '暗号化キーの設定が完了していません。',
    invalid_registration_email: '登録用メールアドレスを確認してください。',
    invalid_phone_number: '電話番号を確認してください。日本の携帯番号は090から入力できます。',
    adult_birth_date_required: '18歳以上の正しい生年月日を入力してください。',
    invalid_height: '身長は120〜230cmで入力してください。',
    gmail_oauth_not_configured: 'Google OAuth設定が完了していません。',
    gmail_code_assist_disabled: '認証コード取得を有効にして、先に保存してください。',
    gmail_access_failed: 'Gmailへアクセスできませんでした。再接続してください。',
    gmail_check_too_frequent: '確認間隔が短すぎます。5秒待ってから再試行してください。',
    invalid_identity_document_metadata: '書類の種類・面・同意を確認してください。',
    identity_document_too_large: 'ファイルは12MB以下にしてください。',
    unsupported_identity_document_type: 'JPEG・PNG・WebP・HEIC・PDFのいずれかを選択してください。',
    identity_document_sensitive_side_rejected: 'マイナンバーカードの裏面は個人番号保護のため保存できません。',
    identity_document_count_limit: '保存できる書類は8件までです。不要な書類を削除してください。',
    identity_document_storage_limit: '本人確認書類の合計保存容量60MBに達しました。',
    identity_document_save_failed: '本人確認書類を保存できませんでした。時間をおいて再試行してください。',
    identity_document_delete_failed: '本人確認書類を削除できませんでした。時間をおいて再試行してください。',
    invalid_profile_photo_metadata: '写真の用途と保存への同意を確認してください。',
    profile_photo_too_large: 'プロフィール写真は1枚8MB以下にしてください。',
    unsupported_profile_photo_type: 'プロフィール写真はJPEG・PNG・WebPのいずれかを選択してください。',
    profile_photo_count_limit: '保存できるプロフィール写真は6枚までです。',
    profile_photo_storage_limit: 'プロフィール写真の合計保存容量32MBに達しました。',
    profile_photo_save_failed: 'プロフィール写真を保存できませんでした。時間をおいて再試行してください。',
    profile_photo_update_failed: 'プロフィール写真を更新できませんでした。',
    profile_photo_delete_failed: 'プロフィール写真を削除できませんでした。',
    invalid_service_password: '選択したサービスのパスワード仕様に合う値を入力してください。',
    invalid_service: 'サービスを選択するか、サービス名を入力してください。',
    service_credential_count_limit: '保存できるサービス数の上限に達しました。',
    service_credential_save_failed: 'サービス用パスワードを保存できませんでした。',
    service_credential_bulk_failed: '一括パスワードを準備できませんでした。時間をおいて再試行してください。',
    invalid_account_password: 'MatchPilotのパスワードが違います。',
    too_many_reveal_attempts: '確認回数が多すぎます。15分後に再試行してください。',
    service_credential_reveal_failed: 'パスワードを表示できませんでした。',
    service_credential_delete_failed: 'サービス用パスワードを削除できませんでした。',
  };
  return messages[code] ?? '処理を完了できませんでした。入力と接続を確認して再試行してください。';
}
