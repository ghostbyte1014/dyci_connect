import React, { useState } from 'react';
import { FaVideo, FaGraduationCap, FaSatelliteDish } from 'react-icons/fa';
import { VideoCarousel } from '../../components/video/VideoCarousel';
import { VideoUploadModal } from '../../components/video/VideoUploadModal';

const BroadcastNetwork: React.FC = () => {
    const [videoModalOpen, setVideoModalOpen] = useState(false);
    const [videoRefreshKey, setVideoRefreshKey] = useState(0);

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 font-sans tracking-tight">
            <header className="unified-header">
                <div className="unified-header-content flex items-center justify-between">
                    <div>
                        <h1 className="unified-header-title">Broadcast Network</h1>
                        <p className="unified-header-subtitle">Institutional Video Delivery & Cloud Upload</p>
                    </div>
                    <button
                        onClick={() => setVideoModalOpen(true)}
                        className="bg-white hover:bg-slate-100 text-dyci-blue text-[10px] font-bold px-4 py-2 rounded-full transition-all shadow-sm active:scale-95 flex items-center uppercase tracking-widest shrink-0 ml-4"
                    >
                        <FaVideo className="mr-2" />
                        <span>Transmit Payload</span>
                    </button>
                </div>
            </header>

            <main className="unified-main">

                {/* Tier 1: Platform Tutorials (CMS Training) */}
                <section className="bg-white rounded-2xl border-y border-r border-y-slate-100 border-r-slate-100 border-l-[6px] border-l-rose-500 shadow-sm p-6 overflow-hidden">
                    <div className="flex items-center space-x-3 mb-6 pb-2 border-b border-slate-50">
                        <div className="h-8 w-8 rounded-lg bg-rose-50 flex items-center justify-center">
                            <FaGraduationCap className="text-rose-500 text-lg" />
                        </div>
                        <div>
                            <h2 className="text-[12px] font-bold text-slate-800 uppercase tracking-widest">Platform Tutorials</h2>
                            <p className="text-[11px] text-slate-500 mt-1">System governance training for faculty and admins.</p>
                        </div>
                    </div>
                    <div className="pt-2">
                        <VideoCarousel
                            key={`tut-${videoRefreshKey}`}
                            category="TUTORIAL"
                            userRole="SYSADMIN"
                            title="Training Modules"
                            allowDelete={true}
                        />
                    </div>
                </section>

                {/* Tier 2: Institutional Broadcasts */}
                <section className="bg-white rounded-2xl border-y border-r border-y-slate-100 border-r-slate-100 border-l-[6px] border-l-indigo-600 shadow-sm p-6 overflow-hidden">
                    <div className="flex items-center space-x-3 mb-6 pb-2 border-b border-slate-50">
                        <div className="h-8 w-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                            <FaSatelliteDish className="text-indigo-500 text-lg" />
                        </div>
                        <div>
                            <h2 className="text-[12px] font-bold text-slate-800 uppercase tracking-widest">Institutional Broadcasts</h2>
                            <p className="text-[11px] text-slate-500 mt-1">Global school-wide announcements and mandatory videos.</p>
                        </div>
                    </div>
                    <div className="pt-2">
                        <VideoCarousel
                            key={`inst-${videoRefreshKey}`}
                            category="INSTITUTIONAL"
                            userRole="SYSADMIN"
                            title="Official Institutional Feeds"
                            allowDelete={true}
                        />
                    </div>
                </section>
            </main>

            <VideoUploadModal
                isOpen={videoModalOpen}
                onClose={() => setVideoModalOpen(false)}
                onSuccess={() => setVideoRefreshKey((k) => k + 1)}
            />

            {/* Legacy Footer */}
            <footer className="max-w-6xl mx-auto px-6 py-12 opacity-40">
                <div className="text-center text-[9px] font-bold uppercase tracking-[0.3em] text-slate-400 border-t border-slate-200 pt-8">
                    CORE_GOVERNANCE_SYSTEM :: VERSION_7.0 :: DYCI CONSTITUTIONAL OVERRIDE
                </div>
            </footer>
        </div>
    );
};

export default BroadcastNetwork;
