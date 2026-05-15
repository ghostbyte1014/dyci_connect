import React, { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import toast from 'react-hot-toast'
import { FaPlus, FaTrash, FaCalculator } from 'react-icons/fa'
import type { Grade } from '../../types'

interface GradeInput {
  subject: string
  grade: string
  units: string
}

const GWA: React.FC = () => {
  const { user } = useAuth()
  const [grades, setGrades] = useState<Grade[]>([])
  const [newGrade, setNewGrade] = useState<GradeInput>({
    subject: '',
    grade: '',
    units: '',
  })
  const [gwa, setGwa] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(false)

  useEffect(() => {
    fetchGrades()
  }, [])

  const fetchGrades = () => {
    const localGrades = JSON.parse(localStorage.getItem('dyci_grades') || '[]')
    setGrades(localGrades)
    calculateGWA(localGrades)
  }

  const calculateGWA = (gradeList: Grade[]) => {
    const validGrades = gradeList.filter(g => g.grade && g.units)
    if (validGrades.length === 0) {
      setGwa(0)
      return
    }

    const totalUnits = validGrades.reduce((sum, g) => sum + parseFloat(g.units.toString()), 0)
    const weightedSum = validGrades.reduce((sum, g) => {
      return sum + (parseFloat(g.grade.toString()) * parseFloat(g.units.toString()))
    }, 0)

    setGwa(parseFloat((weightedSum / totalUnits).toFixed(2)))
  }

  const addGrade = async () => {
    if (!newGrade.subject || !newGrade.grade || !newGrade.units) {
      toast.error('Please fill all fields')
      return
    }

    setLoading(true)
    try {
      const newGradeObj = {
        id: crypto.randomUUID(),
        user_id: user?.id,
        subject: newGrade.subject,
        grade: parseFloat(newGrade.grade),
        units: parseFloat(newGrade.units),
        created_at: new Date().toISOString()
      }

      const updatedGrades = [newGradeObj, ...grades]
      localStorage.setItem('dyci_grades', JSON.stringify(updatedGrades))
      
      toast.success('Grade added locally')
      setNewGrade({ subject: '', grade: '', units: '' })
      fetchGrades()
    } catch (error: any) {
      toast.error('Error adding grade')
    } finally {
      setLoading(false)
    }
  }

  const deleteGrade = (id: string) => {
    const updatedGrades = grades.filter((g) => g.id !== id)
    localStorage.setItem('dyci_grades', JSON.stringify(updatedGrades))
    toast.success('Grade deleted')
    fetchGrades()
  }

  return (
    <>
      <header className="unified-header">
        <div className="unified-header-content">
          <h1 className="unified-header-title">GWA Calculator</h1>
          <p className="unified-header-subtitle">
            Calculate your Grade Weighted Average for personal reference.
          </p>
        </div>
      </header>

      <main className="unified-main">
        {/* DEVELOPMENT NOTE */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
          <div className="h-8 w-8 bg-amber-100 rounded-full flex items-center justify-center shrink-0">
            <span className="text-amber-600 font-bold">!</span>
          </div>
          <div>
            <p className="text-xs font-bold text-amber-900 uppercase tracking-tight">Development Note: Backend Sync Pending</p>
            <p className="text-[10px] text-amber-700">This tool is currently using local storage. Supabase table sync is not yet implemented.</p>
          </div>
        </div>

      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Current GWA</h2>
          <div className="flex items-center space-x-2">
            <FaCalculator className="h-6 w-6 text-blue-500" />
            <span className="text-3xl font-bold text-gray-900">{gwa}</span>
          </div>
        </div>

        <div className="mb-8">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Add New Grade</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input
              type="text"
              placeholder="Subject"
              value={newGrade.subject}
              onChange={(e) => setNewGrade({ ...newGrade, subject: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="number"
              step="0.01"
              placeholder="Grade (1.0-5.0)"
              value={newGrade.grade}
              onChange={(e) => setNewGrade({ ...newGrade, grade: e.target.value })}
              min="1.0"
              max="5.0"
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="number"
              step="0.5"
              placeholder="Units"
              value={newGrade.units}
              onChange={(e) => setNewGrade({ ...newGrade, units: e.target.value })}
              min="0.5"
              max="5.0"
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={addGrade}
            disabled={loading}
            className="mt-4 flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <FaPlus />
            <span>{loading ? 'Adding...' : 'Add Grade'}</span>
          </button>
        </div>

        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Grade Records</h3>
          {grades.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No grades added yet. Add your first grade above.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Subject
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Grade
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Units
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {grades.map((grade) => (
                    <tr key={grade.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {grade.subject}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                          parseFloat(grade.grade.toString()) <= 3.0 
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {grade.grade}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {grade.units}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button
                          onClick={() => deleteGrade(grade.id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          <FaTrash />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-8">
        <div className="flex">
          <div className="ml-3">
            <p className="text-sm text-yellow-700">
              <strong>Important Note:</strong> This GWA calculator is for personal reference only.
              Official grades and GWA are maintained by the Registrar's Office. Always refer to
              your official transcript for academic purposes.
            </p>
          </div>
        </div>
      </div>
      </main>
    </>
  )
}

export default GWA