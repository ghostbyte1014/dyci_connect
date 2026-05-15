import React, { useState } from 'react';
import { FaUpload, FaTimes, FaFilm, FaSpinner, FaCamera, FaImage } from 'react-icons/fa';
import { uploadVideoFile, createVideoMetadata } from '../../lib/api/video';
import type { VideoCategory, VideoTargetRole } from '../../lib/api/video';
import toast from 'react-hot-toast';

interface VideoUploadModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    fixedCategory?: VideoCategory; // If true, forces the upload to be e.g. TUTORIAL
}

export const VideoUploadModal: React.FC<VideoUploadModalProps> = ({ isOpen, onClose, onSuccess, fixedCategory }) => {
    const [file, setFile] = useState<File | null>(null);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [duration, setDuration] = useState('');
    const [category, setCategory] = useState<VideoCategory>(fixedCategory || 'TUTORIAL');
    const [targetRole, setTargetRole] = useState<VideoTargetRole>('ALL');
    const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
    const [videoBlobUrl, setVideoBlobUrl] = useState<string | null>(null);
    const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);

    const [isUploading, setIsUploading] = useState(false);

    if (!isOpen) return null;

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const selectedFile = e.target.files[0];
            if (!selectedFile.type.startsWith('video/')) {
                toast.error('Unsupported file format. Please use MP4 or WebM.')
                return;
            }
            if (selectedFile.size > 100 * 1024 * 1024) { // 100 MB limit frontend check
                toast.error('Payload size too large. Maximum 100MB allowed.')
                return;
            }
            setFile(selectedFile);
            setVideoBlobUrl(URL.createObjectURL(selectedFile));
        }
    };

    const handleThumbnailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const selectedThumb = e.target.files[0];
            setThumbnailFile(selectedThumb);
            setThumbnailPreview(URL.createObjectURL(selectedThumb));
        }
    };

    const captureFrame = () => {
        const videoElement = document.getElementById('video-preview') as HTMLVideoElement;
        if (!videoElement) return;

        const canvas = document.createElement('canvas');
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
                if (blob) {
                    const thumbFile = new File([blob], 'thumbnail.jpg', { type: 'image/jpeg' });
                    setThumbnailFile(thumbFile);
                    setThumbnailPreview(URL.createObjectURL(thumbFile));
                    toast.success('Frame captured as thumbnail!');
                }
            }, 'image/jpeg', 0.9);
        }
    };

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!file || !title) {
            toast.error('Please provide a video file and a title.');
            return;
        }

        setIsUploading(true);
        const toastId = toast.loading('Uploading your video, please wait...');

        try {
            // 1. Send the physical bits to R2
            const { url, error: uploadError } = await uploadVideoFile(file, category);
            if (uploadError || !url) throw uploadError || new Error('Failed to get R2 stream URL');

            // 1b. Upload Thumbnail if exists
            let thumbUrl = null;
            if (thumbnailFile) {
                const { url: tUrl, error: thumbError } = await uploadVideoFile(thumbnailFile, category);
                if (!thumbError && tUrl) {
                    thumbUrl = tUrl;
                    console.log('Thumbnail uploaded to:', thumbUrl);
                } else if (thumbError) {
                    console.error('Thumbnail upload error:', thumbError);
                    toast.error('Thumbnail upload failed. The video upload is still continuing.');
                }
            }

            toast.loading('Upload complete. Saving video details...', { id: toastId });

            // 2. Commit the SQL record
            const { error: dbError } = await createVideoMetadata({
                title,
                description,
                duration: duration || 'Unknown',
                r2_url: url,
                category,
                target_role: targetRole,
                thumbnail_url: thumbUrl || undefined,
                video_size: file.size,
                thumbnail_size: thumbnailFile?.size || 0
            });

            if (dbError) throw dbError;

            toast.success('Video published successfully!', { id: toastId });
            onSuccess();
            onClose();
            setFile(null);
            setTitle('');
            setDescription('');
            setDuration('');
        } catch (err: any) {
            console.error(err);
            toast.error('Upload failed. Please check your connection and try again.', { id: toastId });
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg border-t-4 border-t-dyci-blue overflow-hidden animate-in fade-in zoom-in-95 duration-200">

                <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
                    <div className="flex items-center space-x-3">
                        <div className="h-8 w-8 bg-dyci-blue/10 rounded-lg flex items-center justify-center">
                            <FaFilm className="text-dyci-blue" />
                        </div>
                        <div>
                            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-widest">Upload Video</h2>
                            <p className="text-[10px] text-slate-400 font-medium">Share a video to the broadcast network</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-rose-500 transition-colors">
                        <FaTimes />
                    </button>
                </div>

                <form onSubmit={handleUpload} className="p-6 space-y-5">

                    {/* File Picker */}
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Select Video File</label>
                        <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-slate-300 border-dashed rounded-xl hover:border-dyci-blue hover:bg-blue-50/50 transition-all cursor-pointer relative">
                            <div className="space-y-1 text-center">
                                <FaUpload className="mx-auto h-8 w-8 text-slate-400" />
                                <div className="flex text-sm text-slate-600 justify-center">
                                    <label htmlFor="file-upload" className="relative cursor-pointer rounded-md bg-transparent font-medium text-dyci-blue focus-within:outline-none hover:text-blue-800">
                                        <span>Upload a file</span>
                                        <input id="file-upload" name="file-upload" type="file" accept="video/mp4,video/webm" className="sr-only" onChange={handleFileChange} />
                                    </label>
                                </div>
                                <p className="text-xs text-slate-500">{file ? file.name : 'MP4, WebM up to 100MB'}</p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Broadcast Title</label>
                            <input required type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                                className="w-full text-sm px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-dyci-blue focus:ring-1 focus:ring-dyci-blue"
                                placeholder="e.g. Navigating the Gradebook" />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Duration (Optional)</label>
                                <input type="text" value={duration} onChange={(e) => setDuration(e.target.value)}
                                    className="w-full text-sm px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-dyci-blue focus:ring-1 focus:ring-dyci-blue"
                                    placeholder="e.g. 5:30" />
                            </div>

                            {!fixedCategory && (
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Category</label>
                                    <select value={category} onChange={(e) => setCategory(e.target.value as VideoCategory)}
                                        className="w-full text-sm px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-dyci-blue focus:ring-1 focus:ring-dyci-blue">
                                        <option value="TUTORIAL">System Tutorial</option>
                                        <option value="INSTITUTIONAL">Institutional Broadcast</option>
                                    </select>
                                </div>
                            )}
                        </div>

                        {/* Thumbnail Section */}
                        <div className="space-y-3">
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Premium Thumbnail / Cover Card</label>
                            <div className="grid grid-cols-2 gap-3">
                                {/* Auto Capture or Preview */}
                                <div className="aspect-video bg-slate-100 rounded-xl overflow-hidden relative border border-slate-200">
                                    {videoBlobUrl ? (
                                        <>
                                            <video
                                                id="video-preview"
                                                src={videoBlobUrl}
                                                className="w-full h-full object-cover"
                                                muted
                                                playsInline
                                            />
                                            <button
                                                type="button"
                                                onClick={captureFrame}
                                                className="absolute inset-0 bg-slate-900/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center text-white scale-100 hover:scale-105 active:scale-95"
                                                title="Snap current frame"
                                            >
                                                <FaCamera className="text-xl" />
                                            </button>
                                        </>
                                    ) : (
                                        <div className="h-full flex flex-col items-center justify-center text-slate-300">
                                            <FaFilm className="text-2xl mb-1" />
                                            <span className="text-[9px] font-bold uppercase tracking-tighter">No Video Selected</span>
                                        </div>
                                    )}
                                </div>

                                {/* Selection Preview */}
                                <div className="aspect-video bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-center relative overflow-hidden">
                                    {thumbnailPreview ? (
                                        <img src={thumbnailPreview} className="w-full h-full object-cover" alt="Thumb" />
                                    ) : (
                                        <label className="cursor-pointer h-full w-full flex flex-col items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors">
                                            <FaImage className="text-xl mb-1" />
                                            <span className="text-[9px] font-bold uppercase tracking-tighter">Upload Card</span>
                                            <input type="file" accept="image/*" className="hidden" onChange={handleThumbnailChange} />
                                        </label>
                                    )}
                                    {thumbnailPreview && (
                                        <button
                                            type="button"
                                            onClick={() => { setThumbnailFile(null); setThumbnailPreview(null); }}
                                            className="absolute top-1 right-1 h-5 w-5 bg-rose-500 text-white rounded-full flex items-center justify-center text-[10px]"
                                        >
                                            <FaTimes />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Audience</label>
                            <select value={targetRole} onChange={(e) => setTargetRole(e.target.value as VideoTargetRole)}
                                className="w-full text-sm px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-dyci-blue focus:ring-1 focus:ring-dyci-blue">
                                <option value="ALL">ALL (Global Broadcast)</option>
                                <option value="STUDENT">Students Only</option>
                                <option value="STAFF">All Staff Level</option>
                                <option value="EXECUTIVE_STAFF">Executive Staff</option>
                                <option value="DEPARTMENTAL_STAFF">Departmental Staff</option>
                                <option value="ACAD_ADMIN">Academic Admins</option>
                                <option value="SYSADMIN">System Admins Only</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Description (Optional)</label>
                            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                                className="w-full text-sm px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-dyci-blue focus:ring-1 focus:ring-dyci-blue resize-none"
                                placeholder="Brief summary of the transmission..." />
                        </div>
                    </div>

                    <div className="pt-2">
                        <button
                            type="submit"
                            disabled={isUploading || !file || !title}
                            className={`w-full py-3 rounded-xl font-bold text-[11px] uppercase tracking-widest transition-all text-white flex items-center justify-center space-x-2 shadow-lg
                ${(isUploading || !file || !title) ? 'bg-slate-300 cursor-not-allowed shadow-none' : 'bg-dyci-blue hover:bg-blue-800 shadow-blue-500/20 active:scale-[0.98]'}`}
                        >
                            {isUploading ? <FaSpinner className="animate-spin text-lg" /> : <FaUpload className="text-sm" />}
                            <span>{isUploading ? 'Uploading...' : 'Publish Video'}</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
