<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreProjectRequest;
use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProjectController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return response()->json(
            Project::query()
                ->where('user_id', $request->user()->id)
                ->latest('updated_at')
                ->paginate(20)
        );
    }

    public function store(StoreProjectRequest $request): JsonResponse
    {
        $project = Project::query()->create([
            ...$request->validated(),
            'user_id' => $request->user()->id,
        ]);

        return response()->json($project, 201);
    }

    public function show(Request $request, Project $project): JsonResponse
    {
        abort_unless($project->user_id === $request->user()->id, 404);

        return response()->json($project);
    }

    public function update(StoreProjectRequest $request, Project $project): JsonResponse
    {
        abort_unless($project->user_id === $request->user()->id, 404);
        $project->update($request->validated());

        return response()->json($project->fresh());
    }

    public function destroy(Request $request, Project $project): JsonResponse
    {
        abort_unless($project->user_id === $request->user()->id, 404);
        $project->delete();

        return response()->json(null, 204);
    }
}
